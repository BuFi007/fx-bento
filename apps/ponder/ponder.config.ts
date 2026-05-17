import {
  FX_BENTO_ABIS,
  FX_BENTO_EVENT_NAMES_BY_CONTRACT,
  type ContractName,
} from "@bufinance/fx-bento-contracts";
import { createConfig } from "ponder";
import { http } from "viem";

const databaseUrl = process.env.DATABASE_PRIVATE_URL ?? process.env.DATABASE_URL;
const startBlock = Number(process.env.PONDER_FX_BENTO_START_BLOCK ?? 0);

export default createConfig({
  database: databaseUrl
    ? { kind: "postgres", connectionString: databaseUrl }
    : { kind: "pglite", directory: process.env.PONDER_PGLITE_DIR ?? ".ponder/pglite" },
  chains: {
    default: {
      id: Number(process.env.PONDER_CHAIN_ID ?? 84532),
      rpc: http(process.env.PONDER_RPC_URL ?? "http://127.0.0.1:8545"),
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
  return (process.env[key] ?? `0x${fallbackIndex.toString(16).padStart(40, "0")}`) as `0x${string}`;
}

function camelToSnake(value: string): string {
  return value.replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2");
}
