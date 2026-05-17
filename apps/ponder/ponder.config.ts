import {
  FX_BENTO_ABIS,
  FX_BENTO_EVENT_NAMES_BY_CONTRACT,
  chainContractAddressesFromEnv,
  getContractAddress,
  resolveDeploymentRpcUrl,
  resolveDeploymentStartBlock,
  type ContractName,
} from "@bufinance/fx-bento-contracts";
import { createConfig } from "ponder";
import { http } from "viem";

const databaseUrl =
  process.env.DATABASE_PRIVATE_URL ??
  process.env.DATABASE_URL ??
  process.env.PONDER_SQL_URL ??
  process.env.FX_BENTO_DATABASE_URL;
const chainId = Number(process.env.PONDER_CHAIN_ID ?? process.env.FX_BENTO_CHAIN_ID ?? 84532);
const startBlock = resolveDeploymentStartBlock(process.env, chainId);
const rpcUrl = resolveDeploymentRpcUrl(process.env, chainId) ?? "http://127.0.0.1:8545";
const contractAddresses = chainContractAddressesFromEnv(process.env, chainId);

export default createConfig({
  database: databaseUrl
    ? { kind: "postgres", connectionString: databaseUrl }
    : { kind: "pglite", directory: process.env.PONDER_PGLITE_DIR ?? ".ponder/pglite" },
  chains: {
    default: {
      id: chainId,
      rpc: http(rpcUrl),
    },
  },
  contracts: {
    FXBentoRoomFactory: contractConfig("FXBentoRoomFactory", 1),
    FXBentoRoomEscrow: contractConfig("FXBentoRoomEscrow", 2),
    FXBentoRoundManager: contractConfig("FXBentoRoundManager", 3),
    FXBentoCommitmentManager: contractConfig("FXBentoCommitmentManager", 4),
    FXBentoSettlementManager: contractConfig("FXBentoSettlementManager", 5),
    FXBentoHook: contractConfig("FXBentoHook", 6),
    PoolRegistry: contractConfig("PoolRegistry", 7),
    ProtocolFeeVault: contractConfig("ProtocolFeeVault", 8),
  },
});

export const indexedEventNames = FX_BENTO_EVENT_NAMES_BY_CONTRACT;

function contractConfig(name: ContractName, fallbackIndex: number) {
  return {
    chain: "default" as const,
    abi: FX_BENTO_ABIS[name],
    address: envAddress(name, fallbackIndex),
    startBlock,
  };
}

function envAddress(name: ContractName, fallbackIndex: number): `0x${string}` {
  const key = `PONDER_${camelToSnake(name).toUpperCase()}_ADDRESS`;
  const aliases = FX_BENTO_ADDRESS_ALIASES[name];
  for (const alias of [key, ...aliases]) {
    const value = process.env[alias];
    if (value) return value as `0x${string}`;
  }
  const artifactAddress = getContractAddress(contractAddresses, name, chainId);
  if (artifactAddress) return artifactAddress;
  return `0x${fallbackIndex.toString(16).padStart(40, "0")}` as `0x${string}`;
}

function camelToSnake(value: string): string {
  return value.replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2");
}

const FX_BENTO_ADDRESS_ALIASES = {
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
