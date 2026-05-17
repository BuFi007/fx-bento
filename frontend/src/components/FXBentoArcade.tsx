import * as React from "react";
import { createPublicClient, createWalletClient, custom, getAddress, isAddress, parseAbi, type Address, type Hex } from "viem";
import {
  ROOM_STATUS,
  commitmentHash,
  prepareClaimPrizeTx,
  prepareCommitSelectionTx,
  prepareJoinRoomTx,
  prepareRevealSelectionTx,
  prepareRefundTx,
  roomFlowActions,
  selectedTilesHash,
  validateAntiWall,
  type FxBentoContracts,
  type PreparedTransaction,
  type RoomFlowActions,
  type RoomStatus
} from "../../../sdk/src/index";

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
    };
  }
}

type BackendRoom = {
  id: string;
  contractRoomId?: string;
  market: string;
  entryToken?: string;
  entryFee: string;
  entryFeeRaw?: string;
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  roundDuration: number;
  startTime: number;
  status: RoomStatus;
  statusLabel: string;
  joinIntents: string[];
  activePlayers: string[];
  spectators: string[];
  commitments: number;
  reveals: number;
  leaderboard: Array<{ player: string; score: number }>;
  claimAllocations?: Array<{ player: string; amount: string; proof: Hex[] }>;
  resultsRoot: string | null;
  challengeOpen: boolean;
  settlementRescueDeadline: number | null;
  actions?: RoomFlowActions;
};

type Room = BackendRoom & {
  prizePool: string;
  actions: RoomFlowActions;
};

type TilePick = {
  row: number;
  col: number;
};

type ContractAddressInput = Partial<Record<keyof FxBentoContracts, string>>;

type ClaimAllocation = {
  amount: bigint;
  proof: Hex[];
};

type TxStatus = {
  label: string;
  hash?: Hex;
  error?: string;
};

type ChainState = {
  connected: boolean;
  chainId: number | null;
  matches: boolean;
};

type StoredCommitment = {
  chainId: number;
  roomId: string;
  roundIndex: number;
  player: Address;
  selection: {
    rows: number[];
    cols: number[];
    chipCount: number;
    clientStateHash: Hex;
  };
  nonce: Hex;
  commitment: Hex;
};

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
]);

const sampleRooms: BackendRoom[] = [
  {
    id: "tokyo-1",
    market: "USDC/EURC",
    entryFee: "5 USDC",
    minPlayers: 2,
    maxPlayers: 20,
    rounds: 10,
    roundDuration: 60,
    startTime: Math.floor(Date.now() / 1000) + 180,
    status: ROOM_STATUS.Lobby,
    statusLabel: "lobby",
    joinIntents: [],
    activePlayers: ["0xA11CE00000000000000000000000000000000000", "0xB0B0000000000000000000000000000000000000"],
    spectators: [],
    commitments: 0,
    reveals: 0,
    leaderboard: [],
    resultsRoot: null,
    challengeOpen: false,
    settlementRescueDeadline: null
  },
  {
    id: "quito-2",
    market: "USDC/MXNB",
    entryFee: "5 USDC",
    minPlayers: 2,
    maxPlayers: 10,
    rounds: 10,
    roundDuration: 60,
    startTime: Math.floor(Date.now() / 1000) - 60,
    status: ROOM_STATUS.Settling,
    statusLabel: "settling",
    joinIntents: [],
    activePlayers: [
      "0xA11CE00000000000000000000000000000000000",
      "0xB0B0000000000000000000000000000000000000",
      "0xCA01200000000000000000000000000000000000"
    ],
    spectators: [],
    commitments: 3,
    reveals: 2,
    leaderboard: [
      { player: "0xA11CE00000000000000000000000000000000000", score: 1200 },
      { player: "0xB0B0000000000000000000000000000000000000", score: 980 }
    ],
    resultsRoot: "0x1111111111111111111111111111111111111111111111111111111111111111",
    challengeOpen: true,
    settlementRescueDeadline: Math.floor(Date.now() / 1000) + 3600
  }
];

export function ArcadeLobby({
  backendUrl = "http://localhost:8787",
  chainId = 31337,
  contracts,
  claimAllocations = {}
}: {
  backendUrl?: string;
  chainId?: number;
  contracts?: ContractAddressInput;
  claimAllocations?: Record<string, ClaimAllocation>;
}) {
  const [rooms, setRooms] = React.useState<Room[]>(() => sampleRooms.map(hydrateRoom));
  const [selectedRoomId, setSelectedRoomId] = React.useState(sampleRooms[0]?.id ?? "");
  const [loadState, setLoadState] = React.useState<"idle" | "loading" | "offline">("idle");
  const [walletAddress, setWalletAddress] = React.useState<Address | null>(null);
  const [txStatus, setTxStatus] = React.useState<TxStatus | null>(null);
  const [chainState, setChainState] = React.useState<ChainState>({ connected: false, chainId: null, matches: false });
  const configuredContracts = React.useMemo(() => normalizeContracts(contracts), [contracts]);

  React.useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetch(`${backendUrl}/arcade/rooms`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("rooms unavailable"))))
      .then((payload: BackendRoom[]) => {
        if (cancelled) return;
        const nextRooms = payload.map(hydrateRoom);
        setRooms(nextRooms.length > 0 ? nextRooms : sampleRooms.map(hydrateRoom));
        setSelectedRoomId((current) => nextRooms.find((room) => room.id === current)?.id ?? nextRooms[0]?.id ?? current);
        setLoadState("idle");
      })
      .catch(() => {
        if (!cancelled) setLoadState("offline");
      });
    return () => {
      cancelled = true;
    };
  }, [backendUrl]);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0];
  const indexedClaim = selectedRoom && walletAddress ? claimAllocationForPlayer(selectedRoom, walletAddress) : undefined;
  const selectedClaim = indexedClaim ?? (selectedRoom ? claimAllocations[selectedRoom.id] ?? claimAllocations[selectedRoom.contractRoomId ?? ""] : undefined);

  const refreshChain = React.useCallback(async () => {
    if (!window.ethereum) {
      const next = { connected: false, chainId: null, matches: false };
      setChainState(next);
      return next;
    }
    const hexChainId = await window.ethereum.request({ method: "eth_chainId" }).catch(() => null);
    const currentChainId = typeof hexChainId === "string" ? Number.parseInt(hexChainId, 16) : null;
    const next = { connected: currentChainId !== null, chainId: currentChainId, matches: currentChainId === chainId };
    setChainState(next);
    return next;
  }, [chainId]);

  const connectWallet = React.useCallback(async () => {
    if (!window.ethereum) {
      setTxStatus({ label: "Wallet unavailable", error: "No injected wallet was found." });
      return null;
    }
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const account = Array.isArray(accounts) && typeof accounts[0] === "string" && isAddress(accounts[0])
      ? getAddress(accounts[0])
      : null;
    setWalletAddress(account);
    await refreshChain();
    if (!account) setTxStatus({ label: "Wallet unavailable", error: "No account returned by wallet." });
    return account;
  }, [refreshChain]);

  React.useEffect(() => {
    void refreshChain();
  }, [refreshChain]);

  const ensureChain = React.useCallback(async () => {
    if (!window.ethereum) {
      setTxStatus({ label: "Wallet unavailable", error: "No injected wallet was found." });
      return false;
    }
    const current = await refreshChain();
    if (current.matches) return true;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHexChainId(chainId) }] });
      await refreshChain();
      return true;
    } catch (error) {
      setTxStatus({ label: "Wrong chain", error: error instanceof Error ? error.message : `Switch wallet to chain ${chainId}.` });
      return false;
    }
  }, [chainId, refreshChain]);

  const sendTx = React.useCallback(
    async (label: string, tx: PreparedTransaction) => {
      if (!window.ethereum) {
        setTxStatus({ label, error: "No injected wallet was found." });
        return;
      }
      const account = walletAddress ?? await connectWallet();
      if (!account) return;
      if (!await ensureChain()) return;
      setTxStatus({ label: `${label} pending` });
      try {
        const walletClient = createWalletClient({ account, transport: custom(window.ethereum) });
        const hash = await walletClient.sendTransaction({ account, chain: undefined, to: tx.to, data: tx.data, value: tx.value ?? 0n });
        setTxStatus({ label: `${label} submitted`, hash });
      } catch (error) {
        setTxStatus({ label, error: error instanceof Error ? error.message : "Transaction failed." });
      }
    },
    [connectWallet, ensureChain, walletAddress]
  );

  const preflightJoin = React.useCallback(
    async (room: Room, account: Address) => {
      if (!window.ethereum || !configuredContracts) return false;
      const entryToken = normalizeAddress(room.entryToken);
      const entryFee = readBigIntString(room.entryFeeRaw);
      if (!entryToken || entryFee === null) {
        setTxStatus({ label: "Join room", error: "Entry token or exact entry fee is missing from indexed room state." });
        return false;
      }
      const publicClient = createPublicClient({ transport: custom(window.ethereum) });
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({ address: entryToken, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        publicClient.readContract({ address: entryToken, abi: erc20Abi, functionName: "allowance", args: [account, configuredContracts.roomEscrow] })
      ]);
      if (balance < entryFee) {
        setTxStatus({ label: "Join room", error: "Insufficient entry token balance." });
        return false;
      }
      if (allowance < entryFee) {
        setTxStatus({
          label: "Join room",
          error: `Entry token allowance is too low. Approve ${shortAddress(configuredContracts.roomEscrow)} before joining.`
        });
        return false;
      }
      return true;
    },
    [configuredContracts]
  );

  const handleRoomAction = React.useCallback(
    async (room: Room, action: PrimaryAction) => {
      if (!configuredContracts) {
        setTxStatus({ label: action.label, error: "Contract addresses are not configured." });
        return;
      }
      const roomId = contractRoomId(room);
      if (roomId === null) {
        setTxStatus({ label: action.label, error: "Room is missing a contract room id." });
        return;
      }
      if (action.kind === "join") {
        const account = walletAddress ?? await connectWallet();
        if (!account || !await ensureChain() || !await preflightJoin(room, account)) return;
        await sendTx("Join room", prepareJoinRoomTx(configuredContracts, roomId));
      }
      if (action.kind === "refund") await sendTx("Claim refund", prepareRefundTx(configuredContracts, roomId));
      if (action.kind === "claim") {
        const account = walletAddress ?? await connectWallet();
        if (!account) return;
        const allocation = claimAllocationForPlayer(room, account) ?? claimAllocations[room.id] ?? claimAllocations[room.contractRoomId ?? ""];
        if (!allocation) {
          setTxStatus({ label: "Claim prize", error: "Prize allocation proof is not available yet." });
          return;
        }
        await sendTx("Claim prize", prepareClaimPrizeTx(configuredContracts, { roomId, amount: allocation.amount, proof: allocation.proof }));
      }
    },
    [claimAllocations, configuredContracts, connectWallet, ensureChain, preflightJoin, sendTx, walletAddress]
  );

  return (
    <main className="fxb-shell">
      <section className="fxb-lobby">
        <div>
          <p className="fxb-kicker">FX Bento Arcade</p>
          <h1>FX² Arcade Protocol</h1>
          <p>Join kawaii FX prediction rooms. Same chips. Same market. Highest score wins.</p>
        </div>
        <button className="fxb-primary" type="button">Play FX Bento</button>
      </section>
      <div className="fxb-layout">
        <FXBentoModeCard backendState={loadState} />
        <WalletPanel
          configured={configuredContracts !== null}
          chainState={chainState}
          expectedChainId={chainId}
          status={txStatus}
          walletAddress={walletAddress}
          onConnect={connectWallet}
        />
        <RoomList rooms={rooms} selectedRoomId={selectedRoom?.id} onSelect={setSelectedRoomId} />
        <RoomRulesCard room={selectedRoom} />
        {selectedRoom ? <RoomStatePanel claimAllocation={selectedClaim} onAction={handleRoomAction} room={selectedRoom} /> : null}
        {selectedRoom ? <PrizePoolCard room={selectedRoom} /> : null}
        {selectedRoom ? (
          <GameBoard
            chainId={chainId}
            contracts={configuredContracts}
            onSendTx={sendTx}
            player={walletAddress}
            room={selectedRoom}
            setTxStatus={setTxStatus}
            onConnect={connectWallet}
          />
        ) : null}
        {selectedRoom ? <LiveLeaderboard room={selectedRoom} /> : null}
        {selectedRoom?.status === ROOM_STATUS.Settling ? <RoundResultModal room={selectedRoom} /> : null}
        {selectedRoom?.status === ROOM_STATUS.Settled ? (
          <FinalLeaderboard allocation={selectedClaim} onClaim={() => handleRoomAction(selectedRoom, { kind: "claim", label: "Claim Prize", enabled: true })} room={selectedRoom} />
        ) : null}
      </div>
    </main>
  );
}

export function FXBentoModeCard({ backendState }: { backendState: "idle" | "loading" | "offline" }) {
  return (
    <section className="fxb-panel fxb-mode-card">
      <div>
        <h2>FX Bento</h2>
        <p>Kawaii square-tile FX predictions with capped player-funded prize pools.</p>
      </div>
      <span className={`fxb-status-dot ${backendState}`}>{backendState}</span>
    </section>
  );
}

export function RoomList({ rooms, selectedRoomId, onSelect }: { rooms: Room[]; selectedRoomId?: string; onSelect: (roomId: string) => void }) {
  return (
    <section className="fxb-panel fxb-room-list">
      <h2>Rooms</h2>
      {rooms.map((room) => (
        <button className={`fxb-room-row ${selectedRoomId === room.id ? "selected" : ""}`} key={room.id} onClick={() => onSelect(room.id)} type="button">
          <span>{room.market}</span>
          <span>{room.activePlayers.length}/{room.maxPlayers}</span>
          <strong>{room.prizePool}</strong>
          <em>{room.statusLabel}</em>
        </button>
      ))}
    </section>
  );
}

export function CreateRoomModal() {
  return (
    <form className="fxb-panel">
      <h2>Create Room</h2>
      <label>Market<input defaultValue="USDC/EURC" /></label>
      <label>Entry<input defaultValue="5 USDC" /></label>
      <label>Players<input defaultValue="2-20" /></label>
      <button className="fxb-primary" type="button">Create</button>
    </form>
  );
}

export function RoomRulesCard({ room }: { room?: Room }) {
  const rules = [
    `Entry: ${room?.entryFee ?? "5 USDC"}`,
    `Players: ${room?.minPlayers ?? 2}-${room?.maxPlayers ?? 20}`,
    `Rounds: ${room?.rounds ?? 10}`,
    `Market: ${room?.market ?? "USDC/EURC"}`,
    "Protocol fee: 10%",
    "Prize pool: player-funded",
    "Same chip budget for everyone",
    "Pick future tiles before they lock",
    "Spread chips for safety, concentrate for higher score",
    "No walls, no spam, no last-second sniping"
  ];
  return <section className="fxb-panel"><h2>Rules</h2>{rules.map((rule) => <p key={rule}>{rule}</p>)}</section>;
}

export function WalletPanel({
  chainState,
  configured,
  expectedChainId,
  onConnect,
  status,
  walletAddress
}: {
  chainState: ChainState;
  configured: boolean;
  expectedChainId: number;
  onConnect: () => Promise<Address | null>;
  status: TxStatus | null;
  walletAddress: Address | null;
}) {
  return (
    <section className="fxb-panel">
      <div className="fxb-section-title">
        <h2>Wallet</h2>
        <span className="fxb-pill">{configured ? "contracts ready" : "configure contracts"}</span>
      </div>
      <button className="fxb-secondary" onClick={() => void onConnect()} type="button">
        {walletAddress ? shortAddress(walletAddress) : "Connect Wallet"}
      </button>
      {walletAddress ? (
        <p className={chainState.matches ? "fxb-tx-status" : "fxb-tx-error"}>
          {chainState.matches ? `Chain ${expectedChainId}` : `Switch to chain ${expectedChainId}`}
        </p>
      ) : null}
      {status ? (
        <p className={status.error ? "fxb-tx-error" : "fxb-tx-status"}>
          {status.error ?? (status.hash ? `${status.label}: ${shortAddress(status.hash)}` : status.label)}
        </p>
      ) : null}
    </section>
  );
}

type PrimaryAction = ReturnType<typeof primaryAction>;

export function RoomStatePanel({
  claimAllocation,
  onAction,
  room
}: {
  claimAllocation?: ClaimAllocation;
  onAction: (room: Room, action: PrimaryAction) => void;
  room: Room;
}) {
  const hasContractRoom = contractRoomId(room) !== null;
  const primary = primaryAction(room, claimAllocation, hasContractRoom);
  return (
    <section className="fxb-panel">
      <div className="fxb-section-title">
        <h2>{roomStatusTitle(room)}</h2>
        <span className="fxb-pill">{room.statusLabel}</span>
      </div>
      <PlayerList count={room.activePlayers.length} max={room.maxPlayers} />
      <CommitCountdown seconds={secondsUntil(room.startTime)} />
      <div className="fxb-action-grid">
        <button className="fxb-primary" disabled={!primary.enabled} onClick={() => onAction(room, primary)} type="button">{primary.label}</button>
        <button className="fxb-secondary" disabled={!room.actions.canRescue} type="button">Rescue</button>
      </div>
    </section>
  );
}

export function WaitingRoom({ room }: { room: Room }) {
  return <RoomStatePanel onAction={(_room, _action) => undefined} room={room} />;
}

export function PlayerList({ count, max }: { count: number; max: number }) {
  return <div className="fxb-players">{Array.from({ length: max }, (_, i) => <span className={i < count ? "active" : ""} key={i} />)}</div>;
}

export function PrizePoolCard({ room }: { room: Room }) {
  return (
    <section className="fxb-panel">
      <h2>Prize Pool</h2>
      <strong className="fxb-prize">{room.prizePool}</strong>
      <p>Winners are paid only from room escrow.</p>
    </section>
  );
}

export function GameBoard({
  chainId,
  contracts,
  onConnect,
  onSendTx,
  player,
  room,
  setTxStatus
}: {
  chainId: number;
  contracts: FxBentoContracts | null;
  onConnect: () => Promise<Address | null>;
  onSendTx: (label: string, tx: PreparedTransaction) => Promise<void>;
  player: Address | null;
  room: Room;
  setTxStatus: React.Dispatch<React.SetStateAction<TxStatus | null>>;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [storedCommitment, setStoredCommitment] = React.useState<StoredCommitment | null>(null);
  const picks = [...selected].map(decodeTile);
  const patternError = validateAntiWall({
    rows: picks.map((pick) => pick.row),
    cols: picks.map((pick) => pick.col),
    chipCount: picks.length,
    clientStateHash: "0x0000000000000000000000000000000000000000000000000000000000000000"
  });
  const canSelect = room.actions.canCommitOrReveal || room.status === ROOM_STATUS.Lobby;
  const canCommit = room.actions.canCommitOrReveal && !patternError && selected.size > 0;
  const roomId = contractRoomId(room);
  const roundIndex = 0;

  React.useEffect(() => {
    if (!player || roomId === null) {
      setStoredCommitment(null);
      return;
    }
    setStoredCommitment(loadStoredCommitment(chainId, roomId, roundIndex, player));
  }, [chainId, player, roomId]);

  const toggle = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else if (next.size < 5) next.add(key);
    return next;
  });
  const commitSelection = async () => {
    if (!contracts) return;
    if (roomId === null) return;
    const account = player ?? await onConnect();
    if (!account) return;
    const selection = {
      rows: picks.map((pick) => pick.row),
      cols: picks.map((pick) => pick.col),
      chipCount: picks.length,
      clientStateHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex
    };
    const nonce = randomBytes32();
    const commitment = commitmentHash({
      chainId: BigInt(chainId),
      roomId,
      roundIndex,
      player: account,
      selectedTilesHash: selectedTilesHash(selection),
      nonce
    });
    const stored = {
      chainId,
      roomId: roomId.toString(),
      roundIndex,
      player: account,
      selection,
      nonce,
      commitment
    };
    saveStoredCommitment(stored);
    setStoredCommitment(stored);
    await onSendTx("Commit selection", prepareCommitSelectionTx(contracts, { roomId, roundIndex, commitment }));
  };
  const revealSelection = async () => {
    if (!contracts || roomId === null || !storedCommitment) return;
    if (player && storedCommitment.player.toLowerCase() !== player.toLowerCase()) {
      setTxStatus({ label: "Reveal selection", error: "Stored commitment belongs to a different wallet." });
      return;
    }
    await onSendTx(
      "Reveal selection",
      prepareRevealSelectionTx(contracts, {
        roomId,
        roundIndex: storedCommitment.roundIndex,
        selection: storedCommitment.selection,
        nonce: storedCommitment.nonce
      })
    );
  };

  return (
    <section className="fxb-board-wrap">
      <div className="fxb-board-toolbar">
        <ChipBudgetBar used={selected.size} total={5} />
        <LockZoneOverlay />
      </div>
      <BentoTileGrid disabled={!canSelect} selected={selected} onToggle={toggle} />
      <div className={patternError ? "fxb-warning" : "fxb-score-preview"}>
        {patternError ?? `${Math.max(0, 5 - selected.size)} chips ready`}
      </div>
      <div className="fxb-board-actions">
        <button className="fxb-primary fxb-commit-button" disabled={!canCommit || !contracts || roomId === null} onClick={() => void commitSelection()} type="button">
          Commit Tiles
        </button>
        <button className="fxb-secondary fxb-commit-button" disabled={!contracts || roomId === null || !storedCommitment} onClick={() => void revealSelection()} type="button">
          Reveal Tiles
        </button>
      </div>
    </section>
  );
}

export function BentoTileGrid({ disabled, selected, onToggle }: { disabled?: boolean; selected: Set<string>; onToggle: (key: string) => void }) {
  return (
    <div className="fxb-grid">
      {Array.from({ length: 40 }, (_, i) => (
        <button
          aria-label={`Target tile ${i + 1}`}
          disabled={disabled}
          key={i}
          className={selected.has(String(i)) ? "selected" : ""}
          onClick={() => onToggle(String(i))}
          type="button"
        />
      ))}
    </div>
  );
}

export function ChipBudgetBar({ used, total }: { used: number; total: number }) {
  return <div className="fxb-chipbar"><span>Chips</span><progress value={total - used} max={total} /></div>;
}

export function CommitCountdown({ seconds }: { seconds: number }) {
  return <div className="fxb-countdown">{seconds}s</div>;
}

export function LockZoneOverlay() {
  return <div className="fxb-lock">Lock zone</div>;
}

export function LiveLeaderboard({ room }: { room: Room }) {
  const leaders = room.leaderboard.length > 0 ? room.leaderboard : room.activePlayers.map((player, index) => ({ player, score: Math.max(0, 1000 - index * 120) }));
  return (
    <section className="fxb-panel">
      <h2>Leaderboard</h2>
      <ol className="fxb-leaderboard">
        {leaders.map((entry) => <li key={entry.player}><span>{shortAddress(entry.player)}</span><strong>{entry.score}</strong></li>)}
      </ol>
    </section>
  );
}

export function RoundResultModal({ room }: { room: Room }) {
  return (
    <section className="fxb-panel">
      <h2>{room.challengeOpen ? "Challenge Open" : "Settlement Pending"}</h2>
      <p>{room.reveals}/{room.commitments} reveals indexed</p>
    </section>
  );
}

export function FinalLeaderboard({
  allocation,
  onClaim,
  room
}: {
  allocation?: ClaimAllocation;
  onClaim: () => void;
  room: Room;
}) {
  return <section className="fxb-panel"><h2>Final Leaderboard</h2><ClaimPrizeButton enabled={room.actions.canClaimPrize && allocation !== undefined} onClaim={onClaim} /></section>;
}

export function ClaimPrizeButton({ enabled = true, onClaim }: { enabled?: boolean; onClaim?: () => void }) {
  return <button className="fxb-primary" disabled={!enabled} onClick={onClaim} type="button">Claim Prize</button>;
}

function hydrateRoom(room: BackendRoom): Room {
  const actions = room.actions ?? roomFlowActions({
    status: room.status,
    startTime: BigInt(room.startTime),
    minPlayers: room.minPlayers,
    activePlayers: room.activePlayers.length,
    rounds: room.rounds,
    roundDuration: room.roundDuration,
    resultsSubmitted: room.resultsRoot !== null,
    challengeOpen: room.challengeOpen,
    settlementRescueDeadline: room.settlementRescueDeadline === null ? undefined : BigInt(room.settlementRescueDeadline)
  }, BigInt(Math.floor(Date.now() / 1000)));
  return {
    ...room,
    actions,
    prizePool: estimatePrizePool(room)
  };
}

function estimatePrizePool(room: BackendRoom): string {
  const numericEntry = Number.parseFloat(room.entryFee);
  if (!Number.isFinite(numericEntry)) return room.entryFee;
  const gross = numericEntry * room.activePlayers.length;
  const net = gross * 0.9;
  return `${net.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
}

function primaryAction(
  room: Room,
  claimAllocation?: ClaimAllocation,
  hasContractRoom = true
): { kind: "join" | "refund" | "claim" | "watch"; label: string; enabled: boolean } {
  if (room.actions.canJoin) return { kind: "join", label: "Join Room", enabled: hasContractRoom };
  if (room.actions.canRefund) return { kind: "refund", label: "Claim Refund", enabled: hasContractRoom };
  if (room.actions.canClaimPrize) return { kind: "claim", label: "Claim Prize", enabled: hasContractRoom && claimAllocation !== undefined };
  return { kind: "watch", label: "Watch Room", enabled: false };
}

function roomStatusTitle(room: Room): string {
  if (room.status === ROOM_STATUS.Lobby) return "Waiting Room";
  if (room.status === ROOM_STATUS.Locked) return "Round Live";
  if (room.status === ROOM_STATUS.Settling) return room.challengeOpen ? "Challenge Window" : "Settlement";
  if (room.status === ROOM_STATUS.Settled) return "Claim";
  return "Refund";
}

function secondsUntil(timestamp: number): number {
  return Math.max(0, timestamp - Math.floor(Date.now() / 1000));
}

function decodeTile(key: string): TilePick {
  const index = Number(key);
  return { row: Math.floor(index / 8), col: index % 8 };
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeContracts(input?: ContractAddressInput): FxBentoContracts | null {
  if (!input) return null;
  const roomFactory = normalizeAddress(input.roomFactory);
  const roomEscrow = normalizeAddress(input.roomEscrow);
  const commitmentManager = normalizeAddress(input.commitmentManager);
  const settlementManager = normalizeAddress(input.settlementManager);
  if (!roomFactory || !roomEscrow || !commitmentManager || !settlementManager) return null;
  return { roomFactory, roomEscrow, commitmentManager, settlementManager };
}

function normalizeAddress(value?: string): Address | null {
  return value && isAddress(value) ? getAddress(value) : null;
}

function readBigIntString(value?: string): bigint | null {
  return value && /^\d+$/.test(value) ? BigInt(value) : null;
}

function contractRoomId(room: Room): bigint | null {
  const value = room.contractRoomId ?? (/^\d+$/.test(room.id) ? room.id : null);
  return value && /^\d+$/.test(value) ? BigInt(value) : null;
}

function numberToHexChainId(chainId: number): Hex {
  return `0x${chainId.toString(16)}` as Hex;
}

function claimAllocationForPlayer(room: Room, player: Address): ClaimAllocation | undefined {
  const allocation = room.claimAllocations?.find((entry) => normalizeAddress(entry.player)?.toLowerCase() === player.toLowerCase());
  const amount = readBigIntString(allocation?.amount);
  return allocation && amount !== null ? { amount, proof: allocation.proof } : undefined;
}

function commitmentStorageKey(chainId: number, roomId: bigint, roundIndex: number, player: Address): string {
  return `fx-bento:commitment:${chainId}:${roomId.toString()}:${roundIndex}:${player.toLowerCase()}`;
}

function saveStoredCommitment(commitment: StoredCommitment): void {
  localStorage.setItem(
    commitmentStorageKey(commitment.chainId, BigInt(commitment.roomId), commitment.roundIndex, commitment.player),
    JSON.stringify(commitment)
  );
}

function loadStoredCommitment(chainId: number, roomId: bigint, roundIndex: number, player: Address): StoredCommitment | null {
  const raw = localStorage.getItem(commitmentStorageKey(chainId, roomId, roundIndex, player));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredCommitment;
    if (
      parsed.chainId !== chainId ||
      parsed.roomId !== roomId.toString() ||
      parsed.roundIndex !== roundIndex ||
      normalizeAddress(parsed.player)?.toLowerCase() !== player.toLowerCase() ||
      !normalizeHex32(parsed.nonce) ||
      !normalizeHex32(parsed.commitment) ||
      !normalizeHex32(parsed.selection.clientStateHash)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeHex32(value?: string): Hex | null {
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? value as Hex : null;
}

function randomBytes32(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
