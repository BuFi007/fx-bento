import * as React from "react";
import { ROOM_STATUS, roomFlowActions, validateAntiWall, type RoomFlowActions, type RoomStatus } from "../../../sdk/src/index";

type BackendRoom = {
  id: string;
  contractRoomId?: string;
  market: string;
  entryFee: string;
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

export function ArcadeLobby({ backendUrl = "http://localhost:8787" }: { backendUrl?: string }) {
  const [rooms, setRooms] = React.useState<Room[]>(() => sampleRooms.map(hydrateRoom));
  const [selectedRoomId, setSelectedRoomId] = React.useState(sampleRooms[0]?.id ?? "");
  const [loadState, setLoadState] = React.useState<"idle" | "loading" | "offline">("idle");

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
        <RoomList rooms={rooms} selectedRoomId={selectedRoom?.id} onSelect={setSelectedRoomId} />
        <RoomRulesCard room={selectedRoom} />
        {selectedRoom ? <RoomStatePanel room={selectedRoom} /> : null}
        {selectedRoom ? <PrizePoolCard room={selectedRoom} /> : null}
        {selectedRoom ? <GameBoard room={selectedRoom} /> : null}
        {selectedRoom ? <LiveLeaderboard room={selectedRoom} /> : null}
        {selectedRoom?.status === ROOM_STATUS.Settling ? <RoundResultModal room={selectedRoom} /> : null}
        {selectedRoom?.status === ROOM_STATUS.Settled ? <FinalLeaderboard room={selectedRoom} /> : null}
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

export function RoomStatePanel({ room }: { room: Room }) {
  const primary = primaryAction(room);
  return (
    <section className="fxb-panel">
      <div className="fxb-section-title">
        <h2>{roomStatusTitle(room)}</h2>
        <span className="fxb-pill">{room.statusLabel}</span>
      </div>
      <PlayerList count={room.activePlayers.length} max={room.maxPlayers} />
      <CommitCountdown seconds={secondsUntil(room.startTime)} />
      <div className="fxb-action-grid">
        <button className="fxb-primary" disabled={!primary.enabled} type="button">{primary.label}</button>
        <button className="fxb-secondary" disabled={!room.actions.canRescue} type="button">Rescue</button>
      </div>
    </section>
  );
}

export function WaitingRoom({ room }: { room: Room }) {
  return <RoomStatePanel room={room} />;
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

export function GameBoard({ room }: { room: Room }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const picks = [...selected].map(decodeTile);
  const patternError = validateAntiWall({
    rows: picks.map((pick) => pick.row),
    cols: picks.map((pick) => pick.col),
    chipCount: picks.length,
    clientStateHash: "0x0000000000000000000000000000000000000000000000000000000000000000"
  });
  const canSelect = room.actions.canCommitOrReveal || room.status === ROOM_STATUS.Lobby;
  const toggle = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else if (next.size < 5) next.add(key);
    return next;
  });

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

export function FinalLeaderboard({ room }: { room: Room }) {
  return <section className="fxb-panel"><h2>Final Leaderboard</h2><ClaimPrizeButton enabled={room.actions.canClaimPrize} /></section>;
}

export function ClaimPrizeButton({ enabled = true }: { enabled?: boolean }) {
  return <button className="fxb-primary" disabled={!enabled} type="button">Claim Prize</button>;
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

function primaryAction(room: Room): { label: string; enabled: boolean } {
  if (room.actions.canJoin) return { label: "Join Room", enabled: true };
  if (room.actions.canCancelFailedStart) return { label: "Cancel Room", enabled: true };
  if (room.actions.canLock) return { label: "Lock Room", enabled: true };
  if (room.actions.canRefund) return { label: "Claim Refund", enabled: true };
  if (room.actions.canClaimPrize) return { label: "Claim Prize", enabled: true };
  if (room.actions.canChallenge) return { label: "Challenge", enabled: true };
  if (room.actions.canFinalize) return { label: "Finalize", enabled: true };
  if (room.actions.canCommitOrReveal) return { label: "Commit", enabled: true };
  return { label: "Watch Room", enabled: false };
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
