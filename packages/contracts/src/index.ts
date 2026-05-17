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

type EnvSource = Record<string, string | undefined>;

const CONTRACT_ENV_ALIASES = {
  FXBentoCommitmentManager: ["FX_BENTO_COMMITMENT_MANAGER_ADDRESS"],
  FXBentoHook: ["FX_BENTO_HOOK_ADDRESS"],
  FXBentoRoomEscrow: ["FX_BENTO_ROOM_ESCROW_ADDRESS", "FX_BENTO_ESCROW_ADDRESS"],
  FXBentoRoomFactory: ["FX_BENTO_ROOM_FACTORY_ADDRESS", "FX_BENTO_FACTORY_ADDRESS"],
  FXBentoRoundManager: ["FX_BENTO_ROUND_MANAGER_ADDRESS"],
  FXBentoScoring: ["FX_BENTO_SCORING_ADDRESS"],
  FXBentoSettlementManager: ["FX_BENTO_SETTLEMENT_MANAGER_ADDRESS", "FX_BENTO_SETTLEMENT_ADDRESS"],
  PoolRegistry: ["FX_BENTO_POOL_REGISTRY_ADDRESS"],
  ProtocolFeeVault: ["FX_BENTO_PROTOCOL_FEE_VAULT_ADDRESS"],
} as const satisfies Record<ContractName, readonly string[]>;

export const DeploymentContractNameSchema = z.union([ContractNameSchema, z.literal("PoolManager")]);

export const DeploymentArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    protocol: z.literal("FX² Arcade Protocol"),
    game: z.literal("FX Bento"),
    network: z.string().min(1),
    chainId: z.number().int().positive(),
    rpcUrl: z.string().url(),
    contractsCommit: z.string().regex(/^[0-9a-f]{40}$/),
    deployer: AddressSchema,
    owner: AddressSchema,
    treasury: AddressSchema,
    indexerStartBlock: z.number().int().nonnegative(),
    poolManagerStartBlock: z.number().int().nonnegative(),
    addresses: z.record(DeploymentContractNameSchema, AddressSchema),
    transactions: z.record(DeploymentContractNameSchema, z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
    backendEnv: z.object({
      FX_BENTO_RPC_URL: z.string().url(),
      FX_BENTO_CHAIN_ID: z.string().regex(/^\d+$/),
      FX_BENTO_FROM_BLOCK: z.string().regex(/^\d+$/),
      FX_BENTO_FACTORY_ADDRESS: AddressSchema,
      FX_BENTO_ESCROW_ADDRESS: AddressSchema,
      FX_BENTO_SETTLEMENT_ADDRESS: AddressSchema,
      FX_BENTO_ROUND_MANAGER_ADDRESS: AddressSchema,
      FX_BENTO_HOOK_ADDRESS: AddressSchema,
      FX_BENTO_POOL_REGISTRY_ADDRESS: AddressSchema,
      FX_BENTO_COMMITMENT_MANAGER_ADDRESS: AddressSchema,
      FX_BENTO_PROTOCOL_FEE_VAULT_ADDRESS: AddressSchema,
    }),
    checks: z.object({
      hookPermissions: z.literal(true),
      hookPoolManager: z.literal(true),
      factoryEscrow: z.literal(true),
      vaultFeeNotifier: z.literal(true),
      escrowSettlementManager: z.literal(true),
      settlementRoundManager: z.literal(true),
    }),
  })
  .strict();

export type DeploymentContractName = z.infer<typeof DeploymentContractNameSchema>;
export type DeploymentArtifact = z.infer<typeof DeploymentArtifactSchema>;

export const ARC_TESTNET_DEPLOYMENT = DeploymentArtifactSchema.parse({
  schemaVersion: 1,
  protocol: "FX² Arcade Protocol",
  game: "FX Bento",
  network: "arc-testnet",
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  contractsCommit: "dcd025f035b69eef0dccdb3e479b5336868f6356",
  deployer: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  owner: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  treasury: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  indexerStartBlock: 42625070,
  poolManagerStartBlock: 42624882,
  addresses: {
    PoolManager: "0x3FA22b7Aeda9ebBe34732ea394f1711887363B34",
    PoolRegistry: "0x4d17c86866e6f0eab4908fe4cb4592e56e361084",
    ProtocolFeeVault: "0x468c241484f6aa6bd9555c9533074510dc7d6df1",
    FXBentoHook: "0xa6e3c9c2d6436feb24b165a8bcf6b454e96d50c0",
    FXBentoRoomFactory: "0x385bbd57d0dc2008e4446af7b12dcd158d56034d",
    FXBentoRoomEscrow: "0xab2f146507854334464c4b2326654775d9d947ed",
    FXBentoRoundManager: "0xfb956d033b15276da21579afd5f5b6bf6320869e",
    FXBentoSettlementManager: "0x8f635571aaea4b1391534cd92932caa839e04bcd",
    FXBentoCommitmentManager: "0x6b2c047fa0deb963a9ede1db7d0e4df258880414",
  },
  transactions: {
    PoolManager: "0xe530576aaa0474fee5bae904e7dc64fc7ca1caf60d4dedbf57abc655d5747755",
    PoolRegistry: "0x49f76e64ebbf30da8a510d84f53b567d24543f30d4d6e77ad08239a248166872",
    ProtocolFeeVault: "0x6c131917e52cfa9f1a487d0c039a755db0b4804a0389ed0f579c247a909b6f2b",
    FXBentoHook: "0x029332714849c93541e9bbbd67b9b830de53365c5a5cdbfe8300cf98db9f5499",
    FXBentoRoomFactory: "0x4f1344f124d0f20e789138f022572b35d0921045d64835e9ba757bbd577fc61e",
    FXBentoRoomEscrow: "0x13dd60888101c98ece25f3e0102cbba8e00c945274a927c439c1cdcbbe151776",
    FXBentoRoundManager: "0xe7f3379952431f758bb3ab124292250c2ccfdae59c31c8049f4184cd8e13339f",
    FXBentoSettlementManager: "0xc09199844fbe49c0ec917ca426a3446a2f0100a4dd3ab29421a6b12434540963",
    FXBentoCommitmentManager: "0x4dbabcc4aaa5f48329c8f595706e91d7c86836c98abf5cd15d8fbe44f45cf382",
  },
  backendEnv: {
    FX_BENTO_RPC_URL: "https://rpc.testnet.arc.network",
    FX_BENTO_CHAIN_ID: "5042002",
    FX_BENTO_FROM_BLOCK: "42625070",
    FX_BENTO_FACTORY_ADDRESS: "0x385bbd57d0dc2008e4446af7b12dcd158d56034d",
    FX_BENTO_ESCROW_ADDRESS: "0xab2f146507854334464c4b2326654775d9d947ed",
    FX_BENTO_SETTLEMENT_ADDRESS: "0x8f635571aaea4b1391534cd92932caa839e04bcd",
    FX_BENTO_ROUND_MANAGER_ADDRESS: "0xfb956d033b15276da21579afd5f5b6bf6320869e",
    FX_BENTO_HOOK_ADDRESS: "0xa6e3c9c2d6436feb24b165a8bcf6b454e96d50c0",
    FX_BENTO_POOL_REGISTRY_ADDRESS: "0x4d17c86866e6f0eab4908fe4cb4592e56e361084",
    FX_BENTO_COMMITMENT_MANAGER_ADDRESS: "0x6b2c047fa0deb963a9ede1db7d0e4df258880414",
    FX_BENTO_PROTOCOL_FEE_VAULT_ADDRESS: "0x468c241484f6aa6bd9555c9533074510dc7d6df1",
  },
  checks: {
    hookPermissions: true,
    hookPoolManager: true,
    factoryEscrow: true,
    vaultFeeNotifier: true,
    escrowSettlementManager: true,
    settlementRoundManager: true,
  },
} as const);

export const AVALANCHE_FUJI_DEPLOYMENT = DeploymentArtifactSchema.parse({
  schemaVersion: 1,
  protocol: "FX² Arcade Protocol",
  game: "FX Bento",
  network: "avalanche-fuji",
  chainId: 43113,
  rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  contractsCommit: "dcd025f035b69eef0dccdb3e479b5336868f6356",
  deployer: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  owner: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  treasury: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  indexerStartBlock: 55454938,
  poolManagerStartBlock: 55454914,
  addresses: {
    PoolManager: "0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C",
    PoolRegistry: "0x2931c50745334d6dff9ec4e3106fe05b49717df1",
    ProtocolFeeVault: "0x7ac83373c6b74c7c5b0eee80fb36239a451dc899",
    FXBentoHook: "0x4959be2392a8a2ac27060c26c8f7d070ada9d0c0",
    FXBentoRoomFactory: "0xc7ade54428d51b5d0ceb42e7dd5a47d48515ace1",
    FXBentoRoomEscrow: "0x5d10d2c3b9951054845534b2f60a68ebc0898cd3",
    FXBentoRoundManager: "0x27dbda42adb904115cade37c949bbf670e0ff09d",
    FXBentoSettlementManager: "0xa73208b62af9a87fb5e2b694b27f510d70e17746",
    FXBentoCommitmentManager: "0xaad184861726627968718fde8b94ecac87eb5c5b",
  },
  transactions: {
    PoolManager: "0x5002bbd6105487376c6f465002b8839d96f3884e98e52c405160b908b3ff0f6b",
    PoolRegistry: "0x8932dc8efd0d562b443a73709c73985e5f607273004dd02176c9d20c80cc71db",
    ProtocolFeeVault: "0x08178443b27b047401ecbf08c166e21e151a368d329950af12a131f0644402ee",
    FXBentoHook: "0x850b6453d3a858830d864c00de67d58f7ba8c14e9aa0eef1d7ba33f43166b9bd",
    FXBentoRoomFactory: "0x6a529e530f6681ec339d5bafa49c963420bfc0a24f57654d34859d165297de6f",
    FXBentoRoomEscrow: "0xa505503eeec52d1b18ede96015e7f7f1d34faad7af6294455f91f14adebd0951",
    FXBentoRoundManager: "0x647ce733ec4571bd77c15a2f123736db43a0f52030e5317971a6c73cf1f3a7fb",
    FXBentoSettlementManager: "0x0885da4b10f0569794890c2021210042ee929f7ca7576dc274b7ebbee89fd0ee",
    FXBentoCommitmentManager: "0x70e9b87de86cf2d9d336ae00e43bac6c09c7598ef2a20dbccc288a0bf84df534",
  },
  backendEnv: {
    FX_BENTO_RPC_URL: "https://api.avax-test.network/ext/bc/C/rpc",
    FX_BENTO_CHAIN_ID: "43113",
    FX_BENTO_FROM_BLOCK: "55454938",
    FX_BENTO_FACTORY_ADDRESS: "0xc7ade54428d51b5d0ceb42e7dd5a47d48515ace1",
    FX_BENTO_ESCROW_ADDRESS: "0x5d10d2c3b9951054845534b2f60a68ebc0898cd3",
    FX_BENTO_SETTLEMENT_ADDRESS: "0xa73208b62af9a87fb5e2b694b27f510d70e17746",
    FX_BENTO_ROUND_MANAGER_ADDRESS: "0x27dbda42adb904115cade37c949bbf670e0ff09d",
    FX_BENTO_HOOK_ADDRESS: "0x4959be2392a8a2ac27060c26c8f7d070ada9d0c0",
    FX_BENTO_POOL_REGISTRY_ADDRESS: "0x2931c50745334d6dff9ec4e3106fe05b49717df1",
    FX_BENTO_COMMITMENT_MANAGER_ADDRESS: "0xaad184861726627968718fde8b94ecac87eb5c5b",
    FX_BENTO_PROTOCOL_FEE_VAULT_ADDRESS: "0x7ac83373c6b74c7c5b0eee80fb36239a451dc899",
  },
  checks: {
    hookPermissions: true,
    hookPoolManager: true,
    factoryEscrow: true,
    vaultFeeNotifier: true,
    escrowSettlementManager: true,
    settlementRoundManager: true,
  },
} as const);

export const FX_BENTO_DEPLOYMENTS = {
  [ARC_TESTNET_DEPLOYMENT.chainId]: ARC_TESTNET_DEPLOYMENT,
  [AVALANCHE_FUJI_DEPLOYMENT.chainId]: AVALANCHE_FUJI_DEPLOYMENT,
} as const satisfies Record<number, DeploymentArtifact>;

export function getDeploymentArtifact(chainId: number): DeploymentArtifact | null {
  return FX_BENTO_DEPLOYMENTS[chainId as keyof typeof FX_BENTO_DEPLOYMENTS] ?? null;
}

export function getDeploymentContractAddress(
  chainId: number,
  name: DeploymentContractName
): Address | null {
  return getDeploymentArtifact(chainId)?.addresses[name] ?? null;
}

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

export function contractAddressesFromEnv(source: EnvSource): ContractAddresses {
  const addresses: Partial<Record<ContractName, Address>> = {};
  for (const name of FX_BENTO_CONTRACTS) {
    const value = envAddress(source, CONTRACT_ENV_ALIASES[name]);
    if (value) addresses[name] = value;
  }
  return ContractAddressesSchema.parse(addresses);
}

export function chainContractAddressesFromEnv(
  source: EnvSource,
  fallbackChainId?: number
): ChainContractAddresses {
  const parsed = parseChainContractAddresses(source.CONTRACT_ADDRESSES_JSON);
  const direct = contractAddressesFromEnv(source);
  if (!hasAnyContractAddress(direct)) return parsed;

  const chainId = String(source.FX_BENTO_CHAIN_ID ?? source.PONDER_CHAIN_ID ?? fallbackChainId ?? "0");
  return ChainContractAddressesSchema.parse({
    ...parsed,
    [chainId]: {
      ...(parsed[chainId] ?? {}),
      ...direct,
    },
  });
}

export function hasAnyContractAddress(addresses: ContractAddresses | ChainContractAddresses): boolean {
  for (const name of FX_BENTO_CONTRACTS) {
    if ((addresses as ContractAddresses)[name]) return true;
  }
  return Object.values(addresses as ChainContractAddresses).some(
    (value) =>
      value &&
      typeof value === "object" &&
      FX_BENTO_CONTRACTS.some((name) => Boolean((value as ContractAddresses)[name]))
  );
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

function envAddress(source: EnvSource, keys: readonly string[]): Address | undefined {
  for (const key of keys) {
    const value = source[key];
    if (!value) continue;
    return AddressSchema.parse(value);
  }
  return undefined;
}
