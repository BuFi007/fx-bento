import {
  FX_BENTO_ABIS,
  getContractAddress,
  type ChainContractAddresses,
  type ContractAddresses,
  type ContractName,
} from "@bufinance/fx-bento-contracts";
import { fxBentoArcadeRoom } from "@bufinance/fx-bento-liveblocks";
import { requireMarket } from "@bufinance/fx-bento-market-data";
import {
  AddressSchema,
  HexSchema,
  MarketIdSchema,
  nowIso,
  type Address,
  type Hex,
} from "@bufinance/fx-bento-shared-types";
import {
  concat,
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  type Abi,
} from "viem";
import { z } from "zod";

export * from "./results";

export const FxBentoRoomStatusSchema = z.enum([
  "lobby",
  "active",
  "settling",
  "settled",
  "cancelled",
]);

export const CreateFxBentoRoomSchema = z.object({
  marketId: MarketIdSchema.default("USDC/EURC"),
  entryFeeUsdc: z.coerce.number().positive().max(1_000).default(5),
  minPlayers: z.coerce.number().int().min(2).max(100).default(2),
  maxPlayers: z.coerce.number().int().min(2).max(100).default(20),
  rounds: z.coerce.number().int().min(1).max(32).default(10),
  startTime: z.string().datetime().optional(),
  createdBy: AddressSchema.optional(),
});

export const JoinFxBentoRoomSchema = z.object({
  player: AddressSchema,
  signedEntryIntent: z.string().optional(),
  entryTxHash: HexSchema.optional(),
});

export const CommitSelectionSchema = z.object({
  player: AddressSchema,
  roundIndex: z.coerce.number().int().min(0),
  commitment: HexSchema,
});

export const RevealSelectionSchema = z.object({
  player: AddressSchema,
  roundIndex: z.coerce.number().int().min(0),
  rows: z.array(z.coerce.number().int().min(0).max(7)).min(1).max(5),
  cols: z.array(z.coerce.number().int().min(0).max(7)).min(1).max(5),
  nonce: HexSchema,
});

export const SettleFxBentoRoomSchema = z.object({
  resultsRoot: HexSchema,
  attestor: AddressSchema.optional(),
});

export const Hex32Schema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
  "Expected 32-byte 0x-prefixed hex"
);

const BigNumberishSchema = z
  .union([
    z.bigint(),
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/),
  ])
  .transform((value) => BigInt(value));

export const PoolKeySchema = z.object({
  currency0: AddressSchema,
  currency1: AddressSchema,
  fee: z.coerce.number().int().nonnegative().max(1_000_000),
  tickSpacing: z.coerce.number().int().min(-887272).max(887272),
  hooks: AddressSchema,
});

export const OnchainRoomConfigSchema = z.object({
  poolKey: PoolKeySchema,
  entryToken: AddressSchema,
  entryFee: BigNumberishSchema,
  minPlayers: z.coerce.number().int().min(2).max(100),
  maxPlayers: z.coerce.number().int().min(2).max(100),
  rounds: z.coerce.number().int().min(1).max(256),
  roundDuration: z.coerce.number().int().positive(),
  lockBuffer: z.coerce.number().int().nonnegative(),
  startTime: z.coerce.number().int().nonnegative(),
  rakeBps: z.coerce.number().int().min(0).max(2_000),
  payoutBps: z.array(z.coerce.number().int().min(0).max(10_000)).min(1).max(100),
  gridConfigHash: Hex32Schema,
  isPrivate: z.boolean().default(false),
  inviteCodeHash: Hex32Schema.default(`0x${"00".repeat(32)}` as `0x${string}`),
});

export const TileSelectionSchema = z.object({
  rows: z.array(z.coerce.number().int().min(0).max(255)).min(1).max(5),
  cols: z.array(z.coerce.number().int().min(0).max(255)).min(1).max(5),
  chipCount: z.coerce.number().int().min(1).max(255),
  clientStateHash: Hex32Schema,
});

export const PrizeAllocationSchema = z.object({
  roomId: BigNumberishSchema,
  player: AddressSchema,
  amount: BigNumberishSchema,
  score: BigNumberishSchema.default(0n),
  rank: z.coerce.number().int().positive().default(1),
});

export const SettlementPayoutRootSchema = z.object({
  winnerRoot: Hex32Schema,
  rosterHash: Hex32Schema,
  leaderboardHash: Hex32Schema,
  scoreRoot: Hex32Schema,
  settlementPriceRoot: Hex32Schema,
  payoutTotal: BigNumberishSchema,
  protocolFee: BigNumberishSchema,
  metadataHash: Hex32Schema.optional(),
});

export const SettlementEvidenceSchema = z.object({
  version: z.literal("fx-bento-settlement-evidence-v1").default("fx-bento-settlement-evidence-v1"),
  chainId: z.coerce.number().int().positive(),
  roomId: BigNumberishSchema,
  resultsRoot: Hex32Schema,
  metadataURI: z.string().min(1),
  scorerVersion: z.string().min(1).default("fx-bento-scoring-v1"),
  generatedAt: z.string().datetime().default(nowIso),
  challengeWindowEndsAt: z.string().datetime(),
  rounds: z.array(
    z.object({
      roundIndex: z.coerce.number().int().nonnegative(),
      anchorPrice: z.string().min(1),
      settlementPrice: z.string().min(1),
      anchorTxHash: HexSchema.optional(),
      settlementTxHash: HexSchema.optional(),
    })
  ),
  allocations: z.array(PrizeAllocationSchema).min(1),
  totalPrizePayouts: BigNumberishSchema,
  protocolFee: BigNumberishSchema,
  attestor: AddressSchema.optional(),
  notes: z.string().max(2_000).optional(),
});

export const SettlementChallengeSchema = z.object({
  roomId: BigNumberishSchema,
  challenger: AddressSchema,
  reason: z.enum(["bad_price", "bad_score", "bad_allocation", "missing_data", "operator_error", "other"]),
  evidenceURI: z.string().min(1),
  expectedResultsRoot: Hex32Schema.optional(),
  submittedAt: z.string().datetime().default(nowIso),
});

export type FxBentoRoomStatus = z.infer<typeof FxBentoRoomStatusSchema>;
export type CreateFxBentoRoomInput = z.input<typeof CreateFxBentoRoomSchema>;
export type PoolKey = z.infer<typeof PoolKeySchema>;
export type OnchainRoomConfig = z.output<typeof OnchainRoomConfigSchema>;
export type TileSelection = z.output<typeof TileSelectionSchema>;
export type PrizeAllocation = z.output<typeof PrizeAllocationSchema>;
export type SettlementPayoutRoot = z.output<typeof SettlementPayoutRootSchema>;
export type SettlementEvidence = z.output<typeof SettlementEvidenceSchema>;
export type SettlementChallenge = z.output<typeof SettlementChallengeSchema>;

export interface FxBentoContractEngineConfig {
  chainId: number;
  addresses: ContractAddresses | ChainContractAddresses;
}

export interface FxBentoTransactionRequest {
  contractName: ContractName;
  to: Address;
  functionName: string;
  args: unknown[];
  data: Hex;
  value: "0";
  chainId: number;
}

export interface FxBentoSimulationClient {
  simulateContract: (args: {
    account?: Address;
    address: Address;
    abi: Abi;
    functionName: string;
    args: unknown[];
    value?: bigint;
  }) => Promise<{ request?: unknown; result?: unknown }>;
  readContract: (args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: unknown[];
  }) => Promise<unknown>;
}

export interface FxBentoSafetyCheck {
  simulation: {
    status: "skipped" | "passed";
    reason?: string;
    result?: unknown;
  };
  reconciliation: {
    status: "skipped" | "passed";
    reason?: string;
    indexedStatus?: string | null;
    contractStatus?: string | null;
  };
}

export interface FxBentoIndexedRoomSummary {
  status?: string | null;
  playerCount?: number | null;
}

export interface MerkleAllocation {
  roomId: bigint;
  player: Address;
  amount: bigint;
  score: bigint;
  rank: number;
  leaf: Hex;
  proof: Hex[];
}

export interface SettlementResultTree {
  roomId: bigint;
  root: Hex;
  totalPrizePayouts: bigint;
  allocations: MerkleAllocation[];
}

export interface FxBentoRoom {
  id: string;
  liveblocksRoomId: string;
  marketId: string;
  entryFeeUsdc: number;
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  players: string[];
  playerEntries: Array<{ player: string; entryTxHash: string | null; joinedAt: string }>;
  status: FxBentoRoomStatus;
  createdAt: string;
  startTime: string | null;
  leaderboard: Array<{ player: string; score: number }>;
  commitments: Array<{ player: string; roundIndex: number; commitment: string; at: string }>;
  reveals: Array<{ player: string; roundIndex: number; rows: number[]; cols: number[]; at: string }>;
  settlementRoot: string | null;
  settlementTxHash: string | null;
}

const rooms = new Map<string, FxBentoRoom>();

export function createFxBentoRoom(input: CreateFxBentoRoomInput): FxBentoRoom {
  const parsed = CreateFxBentoRoomSchema.parse(input);
  requireMarket(parsed.marketId);
  if (parsed.minPlayers > parsed.maxPlayers) throw new Error("minPlayers cannot exceed maxPlayers");
  const id = `room_${crypto.randomUUID().slice(0, 8)}`;
  const room: FxBentoRoom = {
    id,
    liveblocksRoomId: fxBentoArcadeRoom(id),
    marketId: parsed.marketId,
    entryFeeUsdc: parsed.entryFeeUsdc,
    minPlayers: parsed.minPlayers,
    maxPlayers: parsed.maxPlayers,
    rounds: parsed.rounds,
    players: [],
    playerEntries: [],
    status: "lobby",
    createdAt: nowIso(),
    startTime: parsed.startTime ?? null,
    leaderboard: [],
    commitments: [],
    reveals: [],
    settlementRoot: null,
    settlementTxHash: null,
  };
  rooms.set(room.id, room);
  return room;
}

export function listFxBentoRooms(): FxBentoRoom[] {
  return [...rooms.values()];
}

export function getFxBentoRoom(id: string): FxBentoRoom | null {
  return rooms.get(id) ?? null;
}

export function joinFxBentoRoom(id: string, input: unknown) {
  const room = requireRoom(id);
  const parsed = JoinFxBentoRoomSchema.parse(input);
  if (room.status !== "lobby") throw new Error("room_not_joinable");
  const player = parsed.player.toLowerCase();
  if (!room.players.includes(player)) {
    if (room.players.length >= room.maxPlayers) throw new Error("room_full");
    room.players.push(player);
    room.playerEntries.push({
      player,
      entryTxHash: parsed.entryTxHash ?? null,
      joinedAt: nowIso(),
    });
  }
  activateIfReady(room);
  return {
    roomId: room.id,
    player,
    liveblocksRoomId: room.liveblocksRoomId,
    onchainRequired: true,
    message: "Submit entry fee to FXBentoRoomEscrow; backend does not custody funds.",
  };
}

export function commitFxBentoSelection(id: string, input: unknown) {
  const room = requireRoom(id);
  const parsed = CommitSelectionSchema.parse(input);
  assertRoomActive(room);
  assertRound(room, parsed.roundIndex);
  const player = parsed.player.toLowerCase();
  assertPlayer(room, player);
  if (
    room.commitments.some(
      (commitment) => commitment.player === player && commitment.roundIndex === parsed.roundIndex
    )
  ) {
    throw new Error("commitment_already_exists");
  }
  room.commitments.push({
    player,
    roundIndex: parsed.roundIndex,
    commitment: parsed.commitment,
    at: nowIso(),
  });
  return { roomId: room.id, accepted: true, commitment: parsed.commitment };
}

export function revealFxBentoSelection(id: string, input: unknown) {
  const room = requireRoom(id);
  const parsed = RevealSelectionSchema.parse(input);
  assertRoomActive(room);
  assertRound(room, parsed.roundIndex);
  if (parsed.rows.length !== parsed.cols.length) throw new Error("rows_cols_length_mismatch");
  const player = parsed.player.toLowerCase();
  assertPlayer(room, player);
  assertValidTilePattern(parsed.rows, parsed.cols);
  const commitment = room.commitments.find(
    (item) => item.player === player && item.roundIndex === parsed.roundIndex
  );
  if (!commitment) throw new Error("missing_commitment");
  if (room.reveals.some((item) => item.player === player && item.roundIndex === parsed.roundIndex)) {
    throw new Error("selection_already_revealed");
  }
  room.reveals.push({
    player,
    roundIndex: parsed.roundIndex,
    rows: parsed.rows,
    cols: parsed.cols,
    at: nowIso(),
  });
  return { roomId: room.id, accepted: true, tiles: parsed.rows.length };
}

export function settleFxBentoRoom(id: string, input: unknown) {
  const room = requireRoom(id);
  const parsed = SettleFxBentoRoomSchema.parse(input);
  if (room.players.length < room.minPlayers) throw new Error("min_players_not_met");
  if (room.status === "settled") throw new Error("room_already_settled");
  if (room.status === "cancelled") throw new Error("room_cancelled");
  room.status = "settling";
  room.settlementRoot = parsed.resultsRoot;
  return {
    roomId: room.id,
    status: room.status,
    resultsRoot: parsed.resultsRoot,
    onchainRequired: true,
  };
}

export function getFxBentoLeaderboard(id: string) {
  return requireRoom(id).leaderboard;
}

export function markFxBentoRoomSettled(id: string, txHash: string) {
  const room = requireRoom(id);
  if (room.status !== "settling") throw new Error("room_not_settling");
  HexSchema.parse(txHash);
  room.status = "settled";
  room.settlementTxHash = txHash;
  return room;
}

export function resetFxBentoRoomsForTests(): void {
  rooms.clear();
}

export function prepareCreateRoomTransaction(
  engine: FxBentoContractEngineConfig,
  input: z.input<typeof OnchainRoomConfigSchema>
): FxBentoTransactionRequest {
  const config = OnchainRoomConfigSchema.parse(input);
  if (config.minPlayers > config.maxPlayers) throw new Error("bad_player_limits");
  if (config.payoutBps.reduce((total, value) => total + value, 0) !== 10_000) {
    throw new Error("bad_payout_split");
  }
  return contractTransaction(engine, "FXBentoRoomFactory", "createRoom", [config]);
}

export function prepareJoinRoomTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "joinRoom", [BigInt(roomId)]);
}

export function prepareLeaveRoomTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "leaveRoom", [BigInt(roomId)]);
}

export function prepareLockRoomTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "lockRoom", [BigInt(roomId)]);
}

export function prepareRefundTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "refund", [BigInt(roomId)]);
}

export function prepareStartRoundTransaction(
  engine: FxBentoContractEngineConfig,
  input: {
    roomId: bigint | number | string;
    roundIndex: number;
    startTime: bigint | number | string;
    endTime: bigint | number | string;
    lockTime: bigint | number | string;
    gridConfigHash: Hex;
  }
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoundManager", "startRound", [
    BigInt(input.roomId),
    input.roundIndex,
    BigInt(input.startTime),
    BigInt(input.endTime),
    BigInt(input.lockTime),
    Hex32Schema.parse(input.gridConfigHash),
  ]);
}

export function prepareRecordAnchorTransaction(
  engine: FxBentoContractEngineConfig,
  input: { roomId: bigint | number | string; roundIndex: number; price: bigint | number | string }
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoundManager", "recordAnchor", [
    BigInt(input.roomId),
    input.roundIndex,
    BigInt(input.price),
  ]);
}

export function prepareRecordSettlementTransaction(
  engine: FxBentoContractEngineConfig,
  input: { roomId: bigint | number | string; roundIndex: number }
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoundManager", "recordSettlement", [
    BigInt(input.roomId),
    input.roundIndex,
  ]);
}

export function prepareCommitSelectionTransaction(
  engine: FxBentoContractEngineConfig,
  input: { roomId: bigint | number | string; roundIndex: number; commitment: Hex }
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoCommitmentManager", "commitSelection", [
    BigInt(input.roomId),
    input.roundIndex,
    Hex32Schema.parse(input.commitment),
  ]);
}

export function prepareBatchedCommitSelectionTransaction(
  engine: FxBentoContractEngineConfig,
  input: {
    roomId: bigint | number | string;
    roundIndex: number;
    player: Address;
    commitment: Hex;
    signature: Hex;
  }
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoCommitmentManager", "commitSelectionFor", [
    BigInt(input.roomId),
    input.roundIndex,
    AddressSchema.parse(input.player),
    Hex32Schema.parse(input.commitment),
    HexSchema.parse(input.signature),
  ]);
}

export function prepareRevealSelectionTransaction(
  engine: FxBentoContractEngineConfig,
  input: {
    roomId: bigint | number | string;
    roundIndex: number;
    selection: z.input<typeof TileSelectionSchema>;
    nonce: Hex;
  }
): FxBentoTransactionRequest {
  const selection = TileSelectionSchema.parse(input.selection);
  assertValidTilePattern(selection.rows, selection.cols);
  return contractTransaction(engine, "FXBentoCommitmentManager", "revealSelection", [
    BigInt(input.roomId),
    input.roundIndex,
    selection,
    Hex32Schema.parse(input.nonce),
  ]);
}

export function prepareClaimPrizeTransaction(
  engine: FxBentoContractEngineConfig,
  input: { roomId: bigint | number | string; amount: bigint | number | string; proof: Hex[] }
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "claimPrize", [
    BigInt(input.roomId),
    BigInt(input.amount),
    input.proof.map((proofItem) => Hex32Schema.parse(proofItem)),
  ]);
}

export function prepareSubmitResultsTransaction(
  engine: FxBentoContractEngineConfig,
  input: {
    roomId: bigint | number | string;
    resultsRoot?: Hex;
    metadataURI: string;
    payout: z.input<typeof SettlementPayoutRootSchema>;
    attestation?: Hex;
  }
): FxBentoTransactionRequest {
  const payout = SettlementPayoutRootSchema.parse({
    ...input.payout,
    winnerRoot: input.payout.winnerRoot ?? input.resultsRoot,
    metadataHash: input.payout.metadataHash ?? keccak256(new TextEncoder().encode(input.metadataURI)),
  });
  return contractTransaction(engine, "FXBentoSettlementManager", "submitResults", [
    BigInt(input.roomId),
    {
      roomId: BigInt(input.roomId),
      winnerRoot: payout.winnerRoot,
      rosterHash: payout.rosterHash,
      leaderboardHash: payout.leaderboardHash,
      scoreRoot: payout.scoreRoot,
      settlementPriceRoot: payout.settlementPriceRoot,
      payoutTotal: payout.payoutTotal,
      protocolFee: payout.protocolFee,
      metadataHash: payout.metadataHash,
    },
    input.metadataURI,
    input.attestation ?? "0x",
  ]);
}

export function prepareFinalizeResultsTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoSettlementManager", "finalizeResults", [BigInt(roomId)]);
}

export function buildSelectedTilesHash(selectionInput: z.input<typeof TileSelectionSchema>): Hex {
  const selection = TileSelectionSchema.parse(selectionInput);
  return keccak256(
    encodeAbiParameters(
      [
        { name: "rows", type: "uint8[]" },
        { name: "cols", type: "uint8[]" },
        { name: "chipCount", type: "uint8" },
        { name: "clientStateHash", type: "bytes32" },
      ],
      [selection.rows, selection.cols, selection.chipCount, selection.clientStateHash]
    )
  );
}

export function buildSelectionCommitment(input: {
  chainId: number;
  roomId: bigint | number | string;
  roundIndex: number;
  player: Address;
  selectedTilesHash: Hex;
  nonce: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "chainId", type: "uint256" },
        { name: "roomId", type: "uint256" },
        { name: "roundIndex", type: "uint16" },
        { name: "player", type: "address" },
        { name: "selectedTilesHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
      ],
      [
        BigInt(input.chainId),
        BigInt(input.roomId),
        input.roundIndex,
        AddressSchema.parse(input.player),
        Hex32Schema.parse(input.selectedTilesHash),
        Hex32Schema.parse(input.nonce),
      ]
    )
  );
}

export function buildPrizeLeaf(input: z.input<typeof PrizeAllocationSchema>): Hex {
  const allocation = PrizeAllocationSchema.parse(input);
  return keccak256(
    encodeAbiParameters(
      [
        { name: "roomId", type: "uint256" },
        { name: "player", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      [allocation.roomId, allocation.player, allocation.amount]
    )
  );
}

export function buildSettlementResultTree(
  roomIdInput: bigint | number | string,
  allocationsInput: Array<z.input<typeof PrizeAllocationSchema>>,
  escrowedAmount?: bigint | number | string,
  protocolFee: bigint | number | string = 0n
): SettlementResultTree {
  const roomId = BigInt(roomIdInput);
  const allocations = allocationsInput
    .map((item) => PrizeAllocationSchema.parse({ ...item, roomId }))
    .sort((a, b) => a.player.toLowerCase().localeCompare(b.player.toLowerCase()));
  const leaves = allocations.map((allocation) => buildPrizeLeaf(allocation));
  const root = buildMerkleRoot(leaves);
  const proofs = leaves.map((_, index) => buildMerkleProof(leaves, index));
  const totalPrizePayouts = allocations.reduce((total, allocation) => total + allocation.amount, 0n);
  if (escrowedAmount !== undefined && totalPrizePayouts + BigInt(protocolFee) > BigInt(escrowedAmount)) {
    throw new Error("payout_exceeds_escrow");
  }
  return {
    roomId,
    root,
    totalPrizePayouts,
    allocations: allocations.map((allocation, index) => ({
      roomId,
      player: allocation.player,
      amount: allocation.amount,
      score: allocation.score,
      rank: allocation.rank,
      leaf: leaves[index] ?? (`0x${"00".repeat(32)}` as Hex),
      proof: proofs[index] ?? [],
    })),
  };
}

export function buildSettlementEvidence(input: z.input<typeof SettlementEvidenceSchema>): SettlementEvidence {
  const evidence = SettlementEvidenceSchema.parse(input);
  const payoutTotal = evidence.allocations.reduce((total, allocation) => total + allocation.amount, 0n);
  if (payoutTotal !== evidence.totalPrizePayouts) throw new Error("settlement_evidence_payout_mismatch");
  return evidence;
}

export function serializeTransactionRequest(request: FxBentoTransactionRequest) {
  return normalizeForJson(request) as Omit<FxBentoTransactionRequest, "args" | "value"> & {
    args: unknown[];
    value: string;
  };
}

export function createFxBentoPublicClient(args: { chainId: number; rpcUrl: string }): FxBentoSimulationClient {
  return createPublicClient({
    chain: defineChain({
      id: args.chainId,
      name: `fx-bento-${args.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [args.rpcUrl] } },
    }),
    transport: http(args.rpcUrl),
  }) as unknown as FxBentoSimulationClient;
}

export async function simulateFxBentoTransaction(
  request: FxBentoTransactionRequest,
  options: { client?: FxBentoSimulationClient; account?: Address } = {}
): Promise<FxBentoSafetyCheck["simulation"]> {
  if (!options.client) return { status: "skipped", reason: "rpc_not_configured" };
  const result = await options.client.simulateContract({
    account: options.account,
    address: request.to,
    abi: FX_BENTO_ABIS[request.contractName],
    functionName: request.functionName,
    args: request.args,
    value: BigInt(request.value),
  });
  return { status: "passed", result: normalizeForJson(result.result) };
}

export async function reconcileFxBentoRoomState(args: {
  engine: FxBentoContractEngineConfig;
  roomId?: bigint | number | string;
  functionName: string;
  indexedRoom?: FxBentoIndexedRoomSummary | null;
  client?: FxBentoSimulationClient;
}): Promise<FxBentoSafetyCheck["reconciliation"]> {
  const expectedStatuses = expectedStatusesForAction(args.functionName);
  if (!args.roomId || expectedStatuses.length === 0) {
    return { status: "skipped", reason: "no_room_reconciliation_required" };
  }
  const indexedStatus = args.indexedRoom?.status ?? null;
  if (indexedStatus && !expectedStatuses.includes(indexedStatus)) {
    throw new Error("indexed_room_state_mismatch");
  }
  if (!args.client) {
    return { status: "skipped", reason: "rpc_not_configured", indexedStatus };
  }
  const factory = getContractAddress(args.engine.addresses, "FXBentoRoomFactory", args.engine.chainId);
  if (!factory) throw new Error("missing_contract_address:FXBentoRoomFactory");
  const room = await args.client.readContract({
    address: factory,
    abi: FX_BENTO_ABIS.FXBentoRoomFactory,
    functionName: "getRoom",
    args: [BigInt(args.roomId)],
  });
  const contractStatus = contractRoomStatus(room);
  if (contractStatus && !expectedStatuses.includes(contractStatus)) {
    throw new Error("contract_room_state_mismatch");
  }
  return { status: "passed", indexedStatus, contractStatus };
}

export async function safetyCheckFxBentoTransaction(args: {
  engine: FxBentoContractEngineConfig;
  request: FxBentoTransactionRequest;
  roomId?: bigint | number | string;
  indexedRoom?: FxBentoIndexedRoomSummary | null;
  client?: FxBentoSimulationClient;
  account?: Address;
}): Promise<FxBentoSafetyCheck> {
  const reconciliation = await reconcileFxBentoRoomState({
    engine: args.engine,
    roomId: args.roomId,
    functionName: args.request.functionName,
    indexedRoom: args.indexedRoom,
    client: args.client,
  });
  const simulation = await simulateFxBentoTransaction(args.request, {
    client: args.client,
    account: args.account,
  });
  return { simulation, reconciliation };
}

function requireRoom(id: string): FxBentoRoom {
  const room = rooms.get(id);
  if (!room) throw new Error("room_not_found");
  return room;
}

function activateIfReady(room: FxBentoRoom): void {
  if (room.status !== "lobby") return;
  if (room.players.length < room.minPlayers) return;
  if (room.startTime && Date.parse(room.startTime) > Date.now()) return;
  room.status = "active";
}

function assertRoomActive(room: FxBentoRoom): void {
  activateIfReady(room);
  if (room.status !== "active") throw new Error("room_not_active");
}

function assertRound(room: FxBentoRoom, roundIndex: number): void {
  if (roundIndex < 0 || roundIndex >= room.rounds) throw new Error("round_out_of_bounds");
}

function assertPlayer(room: FxBentoRoom, player: string): void {
  if (!room.players.includes(player)) throw new Error("player_not_in_room");
}

function assertValidTilePattern(rows: number[], cols: number[]): void {
  if (rows.length === 0 || rows.length !== cols.length || rows.length > 5) {
    throw new Error("invalid_tile_count");
  }
  const seen = new Set<string>();
  const rowCounts = new Map<number, number>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? -1;
    const col = cols[index] ?? -1;
    const key = `${row}:${col}`;
    if (seen.has(key)) throw new Error("duplicate_tile");
    seen.add(key);
    rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
    if ((rowCounts.get(row) ?? 0) > 2) throw new Error("too_many_tiles_in_row");
  }
  const byRow = new Map<number, number[]>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? -1;
    const col = cols[index] ?? -1;
    byRow.set(row, [...(byRow.get(row) ?? []), col]);
  }
  for (const columns of byRow.values()) {
    const sorted = columns.sort((a, b) => a - b);
    let chain = 1;
    for (let index = 1; index < sorted.length; index++) {
      chain = sorted[index] === (sorted[index - 1] ?? -99) + 1 ? chain + 1 : 1;
      if (chain > 2) throw new Error("horizontal_wall");
    }
  }
}

function contractTransaction(
  engine: FxBentoContractEngineConfig,
  contractName: ContractName,
  functionName: string,
  args: unknown[]
): FxBentoTransactionRequest {
  const to = getContractAddress(engine.addresses, contractName, engine.chainId);
  if (!to) throw new Error(`missing_contract_address:${contractName}`);
  const abi = FX_BENTO_ABIS[contractName];
  const data = encodeFunctionData({
    abi: abi as Abi,
    functionName,
    args,
  } as never);
  return {
    contractName,
    to,
    functionName,
    args,
    data,
    value: "0",
    chainId: engine.chainId,
  };
}

function expectedStatusesForAction(functionName: string): string[] {
  switch (functionName) {
    case "joinRoom":
    case "leaveRoom":
      return ["lobby"];
    case "lockRoom":
      return ["lobby", "active"];
    case "refund":
      return ["cancelled"];
    case "startRound":
    case "recordAnchor":
    case "recordSettlement":
      return ["active"];
    case "commitSelection":
    case "commitSelectionFor":
    case "revealSelection":
    case "submitResults":
      return ["active", "settling"];
    case "claimPrize":
      return ["settling", "settled"];
    case "finalizeResults":
      return ["active", "settling", "settled"];
    default:
      return [];
  }
}

function contractRoomStatus(value: unknown): string | null {
  const statusId = Array.isArray(value)
    ? Number(value[14])
    : value && typeof value === "object" && "status" in value
      ? Number((value as { status?: unknown }).status)
      : Number.NaN;
  return (
    ({
      0: "lobby",
      1: "active",
      2: "settling",
      3: "settled",
      4: "cancelled",
    } as Record<number, string>)[statusId] ?? null
  );
}

function buildMerkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) return `0x${"00".repeat(32)}` as Hex;
  let level = [...leaves].sort(compareHex);
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(hashPair(left, right));
    }
    level = next;
  }
  return level[0] ?? (`0x${"00".repeat(32)}` as Hex);
}

function buildMerkleProof(leaves: Hex[], leafIndex: number): Hex[] {
  if (leaves.length <= 1) return [];
  let level = leaves.map((leaf, index) => ({ leaf, originalIndex: index })).sort((a, b) => compareHex(a.leaf, b.leaf));
  let index = level.findIndex((item) => item.originalIndex === leafIndex);
  const proof: Hex[] = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push((level[siblingIndex] ?? level[index])?.leaf ?? (`0x${"00".repeat(32)}` as Hex));
    const next: Array<{ leaf: Hex; originalIndex: number }> = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      const left = level[cursor];
      const right = level[cursor + 1] ?? left;
      if (!left || !right) continue;
      next.push({ leaf: hashPair(left.leaf, right.leaf), originalIndex: left.originalIndex });
    }
    index = Math.floor(index / 2);
    level = next;
  }
  return proof;
}

function hashPair(a: Hex, b: Hex): Hex {
  const [left, right] = compareHex(a, b) <= 0 ? [a, b] : [b, a];
  return keccak256(concat([left, right]));
}

function compareHex(a: Hex, b: Hex): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeForJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeForJson(item)]));
  }
  return value;
}
