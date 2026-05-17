import { parseAbi, type Abi } from "viem";
import { z } from "zod";

import { AddressSchema, type Address } from "@bufinance/fx-bento-shared-types";

export const ContractNameSchema = z.enum([
  "FXBentoCommitmentManager",
  "FXBentoHook",
  "FXBentoRoomEscrow",
  "FXBentoRoomFactory",
  "FXBentoRoundManager",
  "FXBentoScoring",
  "FXBentoSettlementManager",
  "PoolRegistry",
  "ProtocolFeeVault",
]);

export const ContractAddressesSchema = z
  .object({
    FXBentoCommitmentManager: AddressSchema.optional(),
    FXBentoHook: AddressSchema.optional(),
    FXBentoRoomEscrow: AddressSchema.optional(),
    FXBentoRoomFactory: AddressSchema.optional(),
    FXBentoRoundManager: AddressSchema.optional(),
    FXBentoScoring: AddressSchema.optional(),
    FXBentoSettlementManager: AddressSchema.optional(),
    PoolRegistry: AddressSchema.optional(),
    ProtocolFeeVault: AddressSchema.optional(),
  })
  .strict();

export const ChainContractAddressesSchema = z.record(z.string(), ContractAddressesSchema);

export type ContractName = z.infer<typeof ContractNameSchema>;
export type ContractAddresses = z.infer<typeof ContractAddressesSchema>;
export type ChainContractAddresses = z.infer<typeof ChainContractAddressesSchema>;

export const FX_BENTO_CONTRACTS: ContractName[] = ContractNameSchema.options;

export const FX_BENTO_ROOM_FACTORY_EVENTS = [
  "RoomCreated",
  "RoomStatusUpdated",
  "EntryTokenAllowed",
  "LimitsUpdated",
  "EscrowUpdated",
] as const;

export const FX_BENTO_ROOM_ESCROW_EVENTS = [
  "RoomJoined",
  "RoomLeft",
  "RoomCancelled",
  "RoomLocked",
  "RoomSettled",
  "SettlementManagerUpdated",
  "Refunded",
  "PrizeClaimed",
  "ProtocolFeeClaimed",
] as const;

export const FX_BENTO_ROUND_EVENTS = [
  "RoundStarted",
  "AnchorRecorded",
  "SettlementRecorded",
] as const;

export const FX_BENTO_SETTLEMENT_EVENTS = [
  "ResultsSubmitted",
  "ResultsChallenged",
  "ChallengeResolved",
  "ResultsFinalized",
  "SettlementRescueDelayUpdated",
  "SettlementRescued",
] as const;

export const FX_BENTO_COMMITMENT_EVENTS = [
  "SelectionCommitted",
  "SelectionRevealed",
] as const;

export const FX_BENTO_HOOK_EVENTS = [
  "PoolInitialized",
  "FXBentoMarketSnapshot",
  "PreSwapContext",
  "ArcadeFeeVaultUpdated",
  "HookPoolAllowedUpdated",
] as const;

export const FX_BENTO_POOL_REGISTRY_EVENTS = ["PoolAllowed"] as const;

export const FX_BENTO_PROTOCOL_FEE_VAULT_EVENTS = [
  "TreasuryUpdated",
  "FeeNotifierUpdated",
  "FeeReceived",
  "FeeSwept",
] as const;

export const FX_BENTO_EVENT_NAMES_BY_CONTRACT = {
  FXBentoCommitmentManager: FX_BENTO_COMMITMENT_EVENTS,
  FXBentoHook: FX_BENTO_HOOK_EVENTS,
  FXBentoRoomEscrow: FX_BENTO_ROOM_ESCROW_EVENTS,
  FXBentoRoomFactory: FX_BENTO_ROOM_FACTORY_EVENTS,
  FXBentoRoundManager: FX_BENTO_ROUND_EVENTS,
  FXBentoScoring: [] as const,
  FXBentoSettlementManager: FX_BENTO_SETTLEMENT_EVENTS,
  PoolRegistry: FX_BENTO_POOL_REGISTRY_EVENTS,
  ProtocolFeeVault: FX_BENTO_PROTOCOL_FEE_VAULT_EVENTS,
} as const satisfies Record<ContractName, readonly string[]>;

export type FxBentoContractEventName =
  (typeof FX_BENTO_EVENT_NAMES_BY_CONTRACT)[ContractName][number];

export const ROOM_STATUS_BY_ID = {
  0: "lobby",
  1: "active",
  2: "settling",
  3: "settled",
  4: "cancelled",
} as const;

export type OnchainRoomStatusId = keyof typeof ROOM_STATUS_BY_ID;
export type OnchainRoomStatus = (typeof ROOM_STATUS_BY_ID)[OnchainRoomStatusId];

export const FX_BENTO_ROOM_FACTORY_ABI = parseAbi([
  "event RoomCreated(uint256 indexed roomId, bytes32 indexed poolId, address indexed entryToken, uint256 entryFee)",
  "event RoomStatusUpdated(uint256 indexed roomId, uint8 status)",
  "event EntryTokenAllowed(address indexed token, bool allowed)",
  "event LimitsUpdated(uint16 maxRakeBps, uint16 protocolMaxPlayers)",
  "event EscrowUpdated(address indexed escrow)",
  "function createRoom(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,address entryToken,uint256 entryFee,uint16 minPlayers,uint16 maxPlayers,uint16 rounds,uint32 roundDuration,uint32 lockBuffer,uint64 startTime,uint16 rakeBps,uint16[] payoutBps,bytes32 gridConfigHash,bool isPrivate,bytes32 inviteCodeHash) config) returns (uint256 roomId)",
  "function transitionRoomStatus(uint256 roomId, uint8 expectedStatus, uint8 nextStatus)",
  "function setEscrow(address escrow)",
  "function setEntryToken(address token, bool allowed)",
  "function setLimits(uint16 maxRakeBps, uint16 protocolMaxPlayers)",
  "function getRoom(uint256 roomId) view returns ((bytes32 poolId,address entryToken,uint256 entryFee,uint16 minPlayers,uint16 maxPlayers,uint16 rounds,uint32 roundDuration,uint32 lockBuffer,uint64 startTime,uint16 rakeBps,bytes32 payoutHash,bytes32 gridConfigHash,bool isPrivate,bytes32 inviteCodeHash,uint8 status))",
  "function getPayoutBps(uint256 roomId) view returns (uint16[])",
  "function allowedEntryToken(address token) view returns (bool)",
  "function nextRoomId() view returns (uint256)",
]);

export const FX_BENTO_ROOM_ESCROW_ABI = parseAbi([
  "event RoomJoined(uint256 indexed roomId, address indexed player)",
  "event RoomLeft(uint256 indexed roomId, address indexed player)",
  "event RoomCancelled(uint256 indexed roomId)",
  "event RoomLocked(uint256 indexed roomId, uint256 escrowed)",
  "event RoomSettled(uint256 indexed roomId, bytes32 indexed resultsRoot, bytes32 indexed payoutSchemaHash, uint256 payoutTotal, uint256 protocolFee)",
  "event SettlementManagerUpdated(address indexed settlementManager)",
  "event Refunded(uint256 indexed roomId, address indexed player, uint256 amount)",
  "event PrizeClaimed(uint256 indexed roomId, address indexed player, uint256 amount)",
  "event ProtocolFeeClaimed(uint256 indexed roomId, uint256 amount)",
  "function joinRoom(uint256 roomId)",
  "function leaveRoom(uint256 roomId)",
  "function cancelRoom(uint256 roomId)",
  "function refund(uint256 roomId)",
  "function lockRoom(uint256 roomId)",
  "function settleRoom(uint256 roomId, (uint256 roomId,bytes32 winnerRoot,bytes32 rosterHash,bytes32 leaderboardHash,bytes32 scoreRoot,bytes32 settlementPriceRoot,uint256 payoutTotal,uint256 protocolFee,bytes32 metadataHash) payout, bytes attestation)",
  "function claimPrize(uint256 roomId, uint256 amount, bytes32[] proof)",
  "function claimProtocolFee(uint256 roomId)",
  "function players(uint256 roomId) view returns (address[])",
  "function joined(uint256 roomId, address player) view returns (bool)",
  "function refunded(uint256 roomId, address player) view returns (bool)",
  "function prizeClaimed(uint256 roomId, address player) view returns (bool)",
  "function resultsRoot(uint256 roomId) view returns (bytes32)",
  "function escrowed(uint256 roomId) view returns (uint256)",
  "function protocolFee(uint256 roomId) view returns (uint256)",
  "function payoutTotal(uint256 roomId) view returns (uint256)",
  "function payoutSchemaHash(uint256 roomId) view returns (bytes32)",
  "function totalPrizeClaimed(uint256 roomId) view returns (uint256)",
]);

export const FX_BENTO_ROUND_MANAGER_ABI = parseAbi([
  "event RoundStarted(uint256 indexed roomId, uint16 indexed roundIndex, uint64 startTime, uint64 lockTime, uint64 endTime, uint256 anchorSnapshotId)",
  "event AnchorRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price, uint256 snapshotId)",
  "event SettlementRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price, uint256 snapshotId)",
  "function startRound(uint256 roomId, uint16 roundIndex, uint64 startTime, uint64 endTime, uint64 lockTime, bytes32 gridConfigHash)",
  "function recordAnchor(uint256 roomId, uint16 roundIndex, int256 price)",
  "function recordSettlement(uint256 roomId, uint16 roundIndex)",
  "function getRound(uint256 roomId, uint16 roundIndex) view returns ((uint256 roomId,uint16 roundIndex,bytes32 poolId,uint64 startTime,uint64 endTime,uint64 lockTime,int256 anchorPrice,int256 settlementPrice,uint256 anchorSnapshotId,uint256 settlementSnapshotId,bytes32 gridConfigHash,uint8 status))",
  "function allRoundsEnded(uint256 roomId) view returns (bool)",
]);

export const FX_BENTO_COMMITMENT_MANAGER_ABI = parseAbi([
  "event SelectionCommitted(uint256 indexed roomId, uint16 indexed roundIndex, address indexed player, bytes32 commitment)",
  "event SelectionRevealed(uint256 indexed roomId, uint16 indexed roundIndex, address indexed player, bytes32 selectedTilesHash)",
  "function hashSelection(uint256 roomId, uint16 roundIndex, address player, bytes32 selectedTilesHash, bytes32 nonce) view returns (bytes32)",
  "function commitSelection(uint256 roomId, uint16 roundIndex, bytes32 commitment)",
  "function commitSelectionFor(uint256 roomId, uint16 roundIndex, address player, bytes32 commitment, bytes signature)",
  "function revealSelection(uint256 roomId, uint16 roundIndex, (uint8[] rows,uint8[] cols,uint8 chipCount,bytes32 clientStateHash) selection, bytes32 nonce)",
  "function commitments(uint256 roomId, uint16 roundIndex, address player) view returns (bytes32)",
  "function revealedSelectionHash(uint256 roomId, uint16 roundIndex, address player) view returns (bytes32)",
]);

export const FX_BENTO_SETTLEMENT_MANAGER_ABI = parseAbi([
  "event ResultsSubmitted(uint256 indexed roomId, bytes32 indexed resultsRoot, string metadataURI)",
  "event ResultsChallenged(uint256 indexed roomId, bytes proof)",
  "event ChallengeResolved(uint256 indexed roomId, bool accepted)",
  "event ResultsFinalized(uint256 indexed roomId, bytes32 indexed resultsRoot)",
  "event SettlementRescueDelayUpdated(uint64 settlementRescueDelay)",
  "event SettlementRescued(uint256 indexed roomId)",
  "function setChallengeWindow(uint64 challengeWindow)",
  "function setRoundManager(address roundManager)",
  "function setSettlementRescueDelay(uint64 settlementRescueDelay)",
  "function submitResults(uint256 roomId, (uint256 roomId,bytes32 winnerRoot,bytes32 rosterHash,bytes32 leaderboardHash,bytes32 scoreRoot,bytes32 settlementPriceRoot,uint256 payoutTotal,uint256 protocolFee,bytes32 metadataHash) payout, string metadataURI, bytes attestation)",
  "function challengeResults(uint256 roomId, bytes proof)",
  "function resolveChallenge(uint256 roomId, bool acceptChallenge, (uint256 roomId,bytes32 winnerRoot,bytes32 rosterHash,bytes32 leaderboardHash,bytes32 scoreRoot,bytes32 settlementPriceRoot,uint256 payoutTotal,uint256 protocolFee,bytes32 metadataHash) replacement, string metadataURI)",
  "function finalizeResults(uint256 roomId)",
  "function rescueFailedSettlement(uint256 roomId)",
  "function challengeWindow() view returns (uint64)",
  "function settlementRescueDelay() view returns (uint64)",
  "function settlementRescueDeadline(uint256 roomId) view returns (uint64)",
  "function pendingResults(uint256 roomId) view returns ((uint256 roomId,bytes32 winnerRoot,bytes32 rosterHash,bytes32 leaderboardHash,bytes32 scoreRoot,bytes32 settlementPriceRoot,uint256 payoutTotal,uint256 protocolFee,bytes32 metadataHash) payout, bytes32 payoutSchemaHash, string metadataURI, bytes attestation, uint64 submittedAt, uint64 challengedAt, uint8 challengeStatus, bool challenged, bool finalized, bool resolved)",
]);

export const FX_BENTO_HOOK_ABI = parseAbi([
  "event PoolInitialized(bytes32 indexed poolId, address indexed currency0, address indexed currency1)",
  "event FXBentoMarketSnapshot(bytes32 indexed poolId, uint256 indexed snapshotId, uint160 sqrtPriceX96, int24 tick, uint64 timestamp, uint256 volatility)",
  "event PreSwapContext(bytes32 indexed poolId, address indexed sender)",
  "event ArcadeFeeVaultUpdated(address indexed feeVault)",
  "event HookPoolAllowedUpdated(bytes32 indexed poolId, bool allowed)",
  "function setFeeVault(address feeVault)",
  "function setHookPoolAllowed(bytes32 poolId, bool allowed)",
  "function validatePool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key) view returns (bool)",
  "function latestSnapshot(bytes32 poolId) view returns ((uint256 snapshotId,uint160 sqrtPriceX96,int24 tick,uint64 timestamp,uint256 volatility))",
  "function getPoolSnapshot(bytes32 poolId) view returns ((uint256 snapshotId,uint160 sqrtPriceX96,int24 tick,uint64 timestamp,uint256 volatility))",
  "function snapshotById(bytes32 poolId, uint256 snapshotId) view returns ((uint256 snapshotId,uint160 sqrtPriceX96,int24 tick,uint64 timestamp,uint256 volatility))",
  "function realizedVolatility(bytes32 poolId, uint256 window) view returns (uint256)",
]);

export const POOL_REGISTRY_ABI = parseAbi([
  "event PoolAllowed(bytes32 indexed poolId, address indexed baseToken, address indexed quoteToken, address hook, bool allowed)",
  "function setPool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, address oracleSource, bool allowed, uint32 maxStaleSeconds)",
  "function isAllowed(bytes32 poolId) view returns (bool)",
  "function isAllowedKey((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key) view returns (bool)",
  "function getPool(bytes32 poolId) view returns (((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,address baseToken,address quoteToken,address oracleSource,bool allowed,uint32 maxStaleSeconds,int24 tickSpacing,address hook))",
]);

export const PROTOCOL_FEE_VAULT_ABI = parseAbi([
  "event TreasuryUpdated(address indexed treasury)",
  "event FeeNotifierUpdated(address indexed feeNotifier)",
  "event FeeReceived(address indexed token, uint256 indexed roomId, uint256 amount)",
  "event FeeSwept(address indexed token, address indexed treasury, uint256 amount)",
  "function setTreasury(address treasury)",
  "function setFeeNotifier(address feeNotifier)",
  "function notifyFee(address token, uint256 roomId, uint256 amount)",
  "function sweep(address token)",
  "function treasury() view returns (address)",
  "function feeNotifier() view returns (address)",
]);

export const FX_BENTO_SCORING_ABI = parseAbi([
  "function validateAntiWall((uint8[] rows,uint8[] cols,uint8 chipCount,bytes32 clientStateHash) selection, uint8 maxRows, uint8 maxCols) pure returns (bool)",
  "function scoreHit(uint256 tileDifficultyScore, uint8 selectedTileCount) pure returns (uint256)",
  "function scoreSelection((uint8[] rows,uint8[] cols,uint8 chipCount,bytes32 clientStateHash) selection, uint8 hitIndex, uint256 difficulty) pure returns (uint256)",
]);

export const FX_BENTO_ABIS = {
  FXBentoCommitmentManager: FX_BENTO_COMMITMENT_MANAGER_ABI,
  FXBentoHook: FX_BENTO_HOOK_ABI,
  FXBentoRoomEscrow: FX_BENTO_ROOM_ESCROW_ABI,
  FXBentoRoomFactory: FX_BENTO_ROOM_FACTORY_ABI,
  FXBentoRoundManager: FX_BENTO_ROUND_MANAGER_ABI,
  FXBentoScoring: FX_BENTO_SCORING_ABI,
  FXBentoSettlementManager: FX_BENTO_SETTLEMENT_MANAGER_ABI,
  PoolRegistry: POOL_REGISTRY_ABI,
  ProtocolFeeVault: PROTOCOL_FEE_VAULT_ABI,
} as const satisfies Record<ContractName, Abi>;

export function parseContractAddresses(json: string | undefined): ContractAddresses {
  if (!json) return {};
  const parsed = JSON.parse(json);
  if (Object.keys(parsed).some((key) => /^\d+$/.test(key))) {
    const byChain = ChainContractAddressesSchema.parse(parsed);
    return Object.values(byChain)[0] ?? {};
  }
  return ContractAddressesSchema.parse(parsed);
}

export function parseChainContractAddresses(json: string | undefined): ChainContractAddresses {
  if (!json) return {};
  const parsed = JSON.parse(json);
  if (Object.keys(parsed).some((key) => /^\d+$/.test(key))) {
    return ChainContractAddressesSchema.parse(parsed);
  }
  return { "0": ContractAddressesSchema.parse(parsed) };
}

export function getContractAddress(
  addresses: ContractAddresses | ChainContractAddresses,
  name: ContractName,
  chainId?: number
): Address | null {
  if (chainId !== undefined && String(chainId) in addresses) {
    return (addresses as ChainContractAddresses)[String(chainId)]?.[name] ?? null;
  }
  return (addresses as ContractAddresses)[name] ?? (addresses as ChainContractAddresses)["0"]?.[name] ?? null;
}

export function getContractAbi(name: ContractName): Abi {
  return FX_BENTO_ABIS[name];
}

export function getFxBentoContractConfig(args: {
  addresses: ContractAddresses | ChainContractAddresses;
  name: ContractName;
  chainId?: number;
}) {
  const address = getContractAddress(args.addresses, args.name, args.chainId);
  if (!address) throw new Error(`missing_contract_address:${args.name}`);
  return {
    address,
    abi: getContractAbi(args.name),
  };
}
