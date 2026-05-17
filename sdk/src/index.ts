import { encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbiParameters, type Address, type Hex } from "viem";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type RoomConfig = {
  poolKey: PoolKey;
  entryToken: Address;
  entryFee: bigint;
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  roundDuration: number;
  lockBuffer: number;
  startTime: bigint;
  rakeBps: number;
  payoutBps: number[];
  gridConfigHash: Hex;
  isPrivate: boolean;
  inviteCodeHash: Hex;
};

export type TileSelection = {
  rows: number[];
  cols: number[];
  chipCount: number;
  clientStateHash: Hex;
};

export type PayoutRoot = {
  roomId: bigint;
  winnerRoot: Hex;
  rosterHash: Hex;
  leaderboardHash: Hex;
  scoreRoot: Hex;
  settlementPriceRoot: Hex;
  payoutTotal: bigint;
  protocolFee: bigint;
  metadataHash: Hex;
};

export type FxBentoContracts = {
  roomFactory: Address;
  roomEscrow: Address;
  commitmentManager: Address;
  settlementManager: Address;
};

export type PreparedTransaction = {
  to: Address;
  data: Hex;
  value?: bigint;
};

export const ROOM_STATUS = {
  Lobby: 0,
  Locked: 1,
  Settling: 2,
  Settled: 3,
  Cancelled: 4
} as const;

export type RoomStatus = (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS];

export type RoomLifecycleView = {
  status: RoomStatus;
  startTime: bigint;
  minPlayers: number;
  activePlayers: number;
  rounds: number;
  roundDuration: number;
  resultsSubmitted?: boolean;
  challengeOpen?: boolean;
  settlementRescueDeadline?: bigint;
};

export type RoomFlowActions = {
  canJoin: boolean;
  canLeave: boolean;
  canCancelFailedStart: boolean;
  canLock: boolean;
  canCommitOrReveal: boolean;
  canSubmitResults: boolean;
  canChallenge: boolean;
  canFinalize: boolean;
  canRefund: boolean;
  canClaimPrize: boolean;
  canRescue: boolean;
};

export const FX_BENTO_COPY = {
  protocol: "FX² Arcade Protocol",
  game: "FX Bento",
  frontendMode: "FX Bento Arcade",
  cta: "Play FX Bento",
  lobby: "Join kawaii FX prediction rooms. Same chips. Same market. Highest score wins."
} as const;

export function poolId(poolKey: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks
    ])
  );
}

export function selectedTilesHash(selection: TileSelection): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint8[],uint8[],uint8,bytes32"), [
      selection.rows,
      selection.cols,
      selection.chipCount,
      selection.clientStateHash
    ])
  );
}

export function commitmentHash(args: {
  chainId: bigint;
  roomId: bigint;
  roundIndex: number;
  player: Address;
  selectedTilesHash: Hex;
  nonce: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256,uint256,uint16,address,bytes32,bytes32"), [
      args.chainId,
      args.roomId,
      args.roundIndex,
      args.player,
      args.selectedTilesHash,
      args.nonce
    ])
  );
}

export const TILE_COMMITMENT_TYPEHASH = keccak256(
  encodePacked(["string"], ["TileCommitment(uint256 roomId,uint16 roundIndex,address player,bytes32 commitment)"])
);

export function commitmentManagerDomainSeparator(args: { chainId: bigint; verifyingContract: Address }): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("uint256,address"), [args.chainId, args.verifyingContract]));
}

export function tileCommitmentDigest(args: {
  chainId: bigint;
  verifyingContract: Address;
  roomId: bigint;
  roundIndex: number;
  player: Address;
  commitment: Hex;
}): Hex {
  const domainSeparator = commitmentManagerDomainSeparator({
    chainId: args.chainId,
    verifyingContract: args.verifyingContract
  });
  const structHash = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,uint256,uint16,address,bytes32"), [
      TILE_COMMITMENT_TYPEHASH,
      args.roomId,
      args.roundIndex,
      args.player,
      args.commitment
    ])
  );
  return keccak256(encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSeparator, structHash]));
}

export function roomFlowActions(room: RoomLifecycleView, now: bigint): RoomFlowActions {
  const filled = room.activePlayers >= room.minPlayers;
  const startReached = now >= room.startTime;
  return {
    canJoin: room.status === ROOM_STATUS.Lobby,
    canLeave: room.status === ROOM_STATUS.Lobby,
    canCancelFailedStart: room.status === ROOM_STATUS.Lobby && startReached && !filled,
    canLock: room.status === ROOM_STATUS.Lobby && startReached && filled,
    canCommitOrReveal: room.status === ROOM_STATUS.Locked || room.status === ROOM_STATUS.Settling,
    canSubmitResults: room.status === ROOM_STATUS.Locked || room.status === ROOM_STATUS.Settling,
    canChallenge: room.status === ROOM_STATUS.Settling && room.resultsSubmitted === true && room.challengeOpen === true,
    canFinalize: room.status === ROOM_STATUS.Settling && room.resultsSubmitted === true && room.challengeOpen !== true,
    canRefund: room.status === ROOM_STATUS.Cancelled,
    canClaimPrize: room.status === ROOM_STATUS.Settled,
    canRescue:
      (room.status === ROOM_STATUS.Locked || room.status === ROOM_STATUS.Settling) &&
      room.settlementRescueDeadline !== undefined &&
      now >= room.settlementRescueDeadline
  };
}

const roomFactoryAbi = [
  {
    type: "function",
    name: "createRoom",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "config",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" }
            ]
          },
          { name: "entryToken", type: "address" },
          { name: "entryFee", type: "uint256" },
          { name: "minPlayers", type: "uint16" },
          { name: "maxPlayers", type: "uint16" },
          { name: "rounds", type: "uint16" },
          { name: "roundDuration", type: "uint32" },
          { name: "lockBuffer", type: "uint32" },
          { name: "startTime", type: "uint64" },
          { name: "rakeBps", type: "uint16" },
          { name: "payoutBps", type: "uint16[]" },
          { name: "gridConfigHash", type: "bytes32" },
          { name: "isPrivate", type: "bool" },
          { name: "inviteCodeHash", type: "bytes32" }
        ]
      }
    ],
    outputs: [{ name: "roomId", type: "uint256" }]
  }
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "ok", type: "bool" }]
  }
] as const;

const roomEscrowAbi = [
  { type: "function", name: "joinRoom", stateMutability: "nonpayable", inputs: [{ name: "roomId", type: "uint256" }], outputs: [] },
  { type: "function", name: "leaveRoom", stateMutability: "nonpayable", inputs: [{ name: "roomId", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancelRoom", stateMutability: "nonpayable", inputs: [{ name: "roomId", type: "uint256" }], outputs: [] },
  { type: "function", name: "refund", stateMutability: "nonpayable", inputs: [{ name: "roomId", type: "uint256" }], outputs: [] },
  { type: "function", name: "lockRoom", stateMutability: "nonpayable", inputs: [{ name: "roomId", type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "claimPrize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "proof", type: "bytes32[]" }
    ],
    outputs: []
  },
  { type: "function", name: "claimProtocolFee", stateMutability: "nonpayable", inputs: [{ name: "roomId", type: "uint256" }], outputs: [] }
] as const;

const commitmentManagerAbi = [
  {
    type: "function",
    name: "commitSelection",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "roundIndex", type: "uint16" },
      { name: "commitment", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "commitSelectionFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "roundIndex", type: "uint16" },
      { name: "player", type: "address" },
      { name: "commitment", type: "bytes32" },
      { name: "signature", type: "bytes" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "revealSelection",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "roundIndex", type: "uint16" },
      {
        name: "selection",
        type: "tuple",
        components: [
          { name: "rows", type: "uint8[]" },
          { name: "cols", type: "uint8[]" },
          { name: "chipCount", type: "uint8" },
          { name: "clientStateHash", type: "bytes32" }
        ]
      },
      { name: "nonce", type: "bytes32" }
    ],
    outputs: []
  }
] as const;

const settlementManagerAbi = [
  {
    type: "function",
    name: "submitResults",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roomId", type: "uint256" },
      {
        name: "payout",
        type: "tuple",
        components: [
          { name: "roomId", type: "uint256" },
          { name: "winnerRoot", type: "bytes32" },
          { name: "rosterHash", type: "bytes32" },
          { name: "leaderboardHash", type: "bytes32" },
          { name: "scoreRoot", type: "bytes32" },
          { name: "settlementPriceRoot", type: "bytes32" },
          { name: "payoutTotal", type: "uint256" },
          { name: "protocolFee", type: "uint256" },
          { name: "metadataHash", type: "bytes32" }
        ]
      },
      { name: "metadataURI", type: "string" },
      { name: "attestation", type: "bytes" }
    ],
    outputs: []
  },
  { type: "function", name: "challengeResults", stateMutability: "nonpayable", inputs: [{ name: "roomId", type: "uint256" }, { name: "proof", type: "bytes" }], outputs: [] },
  { type: "function", name: "finalizeResults", stateMutability: "nonpayable", inputs: [{ name: "roomId", type: "uint256" }], outputs: [] },
  { type: "function", name: "rescueFailedSettlement", stateMutability: "nonpayable", inputs: [{ name: "roomId", type: "uint256" }], outputs: [] }
] as const;

export function encodeCreateRoom(config: RoomConfig): Hex {
  return encodeFunctionData({ abi: roomFactoryAbi, functionName: "createRoom", args: [config] });
}

export function prepareCreateRoomTx(contracts: FxBentoContracts, config: RoomConfig): PreparedTransaction {
  return { to: contracts.roomFactory, data: encodeCreateRoom(config) };
}

export function prepareApproveErc20Tx(
  token: Address,
  args: { spender: Address; amount: bigint }
): PreparedTransaction {
  return {
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [args.spender, args.amount] })
  };
}

export function prepareJoinRoomTx(contracts: FxBentoContracts, roomId: bigint): PreparedTransaction {
  return { to: contracts.roomEscrow, data: encodeFunctionData({ abi: roomEscrowAbi, functionName: "joinRoom", args: [roomId] }) };
}

export function prepareLeaveRoomTx(contracts: FxBentoContracts, roomId: bigint): PreparedTransaction {
  return { to: contracts.roomEscrow, data: encodeFunctionData({ abi: roomEscrowAbi, functionName: "leaveRoom", args: [roomId] }) };
}

export function prepareCancelRoomTx(contracts: FxBentoContracts, roomId: bigint): PreparedTransaction {
  return { to: contracts.roomEscrow, data: encodeFunctionData({ abi: roomEscrowAbi, functionName: "cancelRoom", args: [roomId] }) };
}

export function prepareRefundTx(contracts: FxBentoContracts, roomId: bigint): PreparedTransaction {
  return { to: contracts.roomEscrow, data: encodeFunctionData({ abi: roomEscrowAbi, functionName: "refund", args: [roomId] }) };
}

export function prepareLockRoomTx(contracts: FxBentoContracts, roomId: bigint): PreparedTransaction {
  return { to: contracts.roomEscrow, data: encodeFunctionData({ abi: roomEscrowAbi, functionName: "lockRoom", args: [roomId] }) };
}

export function prepareCommitSelectionTx(
  contracts: FxBentoContracts,
  args: { roomId: bigint; roundIndex: number; commitment: Hex }
): PreparedTransaction {
  return {
    to: contracts.commitmentManager,
    data: encodeFunctionData({
      abi: commitmentManagerAbi,
      functionName: "commitSelection",
      args: [args.roomId, args.roundIndex, args.commitment]
    })
  };
}

export function prepareBatchedCommitSelectionTx(
  contracts: FxBentoContracts,
  args: { roomId: bigint; roundIndex: number; player: Address; commitment: Hex; signature: Hex }
): PreparedTransaction {
  return {
    to: contracts.commitmentManager,
    data: encodeFunctionData({
      abi: commitmentManagerAbi,
      functionName: "commitSelectionFor",
      args: [args.roomId, args.roundIndex, args.player, args.commitment, args.signature]
    })
  };
}

export function prepareRevealSelectionTx(
  contracts: FxBentoContracts,
  args: { roomId: bigint; roundIndex: number; selection: TileSelection; nonce: Hex }
): PreparedTransaction {
  return {
    to: contracts.commitmentManager,
    data: encodeFunctionData({
      abi: commitmentManagerAbi,
      functionName: "revealSelection",
      args: [args.roomId, args.roundIndex, args.selection, args.nonce]
    })
  };
}

export function prepareClaimPrizeTx(
  contracts: FxBentoContracts,
  args: { roomId: bigint; amount: bigint; proof: Hex[] }
): PreparedTransaction {
  return {
    to: contracts.roomEscrow,
    data: encodeFunctionData({ abi: roomEscrowAbi, functionName: "claimPrize", args: [args.roomId, args.amount, args.proof] })
  };
}

export function prepareClaimProtocolFeeTx(contracts: FxBentoContracts, roomId: bigint): PreparedTransaction {
  return {
    to: contracts.roomEscrow,
    data: encodeFunctionData({ abi: roomEscrowAbi, functionName: "claimProtocolFee", args: [roomId] })
  };
}

export function prepareSubmitResultsTx(
  contracts: FxBentoContracts,
  args: { roomId: bigint; payout: PayoutRoot; metadataURI: string; attestation: Hex }
): PreparedTransaction {
  return {
    to: contracts.settlementManager,
    data: encodeFunctionData({
      abi: settlementManagerAbi,
      functionName: "submitResults",
      args: [args.roomId, args.payout, args.metadataURI, args.attestation]
    })
  };
}

export function prepareChallengeResultsTx(contracts: FxBentoContracts, args: { roomId: bigint; proof: Hex }): PreparedTransaction {
  return {
    to: contracts.settlementManager,
    data: encodeFunctionData({ abi: settlementManagerAbi, functionName: "challengeResults", args: [args.roomId, args.proof] })
  };
}

export function prepareFinalizeResultsTx(contracts: FxBentoContracts, roomId: bigint): PreparedTransaction {
  return {
    to: contracts.settlementManager,
    data: encodeFunctionData({ abi: settlementManagerAbi, functionName: "finalizeResults", args: [roomId] })
  };
}

export function prepareRescueFailedSettlementTx(contracts: FxBentoContracts, roomId: bigint): PreparedTransaction {
  return {
    to: contracts.settlementManager,
    data: encodeFunctionData({ abi: settlementManagerAbi, functionName: "rescueFailedSettlement", args: [roomId] })
  };
}

export function validateAntiWall(selection: TileSelection, maxRows = 5, maxCols = 8): string | null {
  const n = selection.rows.length;
  if (n === 0 || n !== selection.cols.length || n > 5 || selection.chipCount !== n) return "Pick 1-5 tiles.";
  const seen = new Set<string>();
  const rowCounts = new Array(maxRows).fill(0);
  const colCounts = new Array(maxCols).fill(0);
  const occupied = Array.from({ length: maxRows }, () => new Array(maxCols).fill(false));

  for (let i = 0; i < n; i++) {
    const row = selection.rows[i] ?? -1;
    const col = selection.cols[i] ?? -1;
    const key = `${row}:${col}`;
    if (row < 0 || row >= maxRows || col < 0 || col >= maxCols || seen.has(key)) return "Tile is outside the board.";
    seen.add(key);
    occupied[row][col] = true;
    rowCounts[row] += 1;
    colCounts[col] += 1;
    if (rowCounts[row] > 2) return "No more than two tiles per row.";
  }

  for (let row = 0; row < maxRows; row++) {
    let chain = 0;
    for (let col = 0; col < maxCols; col++) {
      chain = occupied[row][col] ? chain + 1 : 0;
      if (chain > 2) return "No horizontal walls.";
    }
  }
  if (rowCounts.some((count) => count === maxCols) || colCounts.some((count) => count === maxRows)) return "No full row or column walls.";
  return null;
}
