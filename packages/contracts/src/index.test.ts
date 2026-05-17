import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ARC_TESTNET_DEPLOYMENT,
  AVALANCHE_FUJI_DEPLOYMENT,
  DeploymentArtifactSchema,
  FX_BENTO_DEPLOYMENTS,
  FX_BENTO_ABIS,
  FX_BENTO_EVENT_NAMES_BY_CONTRACT,
  FX_BENTO_ROOM_ESCROW_EVENTS,
  FX_BENTO_SETTLEMENT_EVENTS,
  chainContractAddressesFromEnv,
  getContractAddress,
  getDeploymentContractAddress,
  resolveDeploymentRpcUrl,
  resolveDeploymentStartBlock,
  type ContractName,
} from ".";

describe("FX Bento contract metadata", () => {
  test("exports event names that match ABI fragments", () => {
    for (const [contractName, eventNames] of Object.entries(FX_BENTO_EVENT_NAMES_BY_CONTRACT)) {
      const abi = FX_BENTO_ABIS[contractName as ContractName];
      const abiEventNames = new Set(abi.filter((item) => item.type === "event").map((item) => item.name));
      for (const eventName of eventNames) {
        expect(abiEventNames.has(eventName)).toBe(true);
      }
    }
  });

  test("uses current Solidity event names for refund, commitment, and settlement", () => {
    expect(FX_BENTO_ROOM_ESCROW_EVENTS).toContain("Refunded");
    expect(FX_BENTO_ROOM_ESCROW_EVENTS).not.toContain("RefundClaimed" as never);
    expect(FX_BENTO_ROOM_ESCROW_EVENTS).toContain("SettlementManagerUpdated");
    expect(FX_BENTO_SETTLEMENT_EVENTS).toContain("ResultsSubmitted");
    expect(FX_BENTO_SETTLEMENT_EVENTS).toContain("ChallengeResolved");
    expect(FX_BENTO_SETTLEMENT_EVENTS).toContain("SettlementRescued");
    expect(FX_BENTO_SETTLEMENT_EVENTS).not.toContain("ResultsRootPosted" as never);
  });

  test("exported event payloads match current Foundry artifacts", () => {
    for (const [contractName, eventNames] of Object.entries(FX_BENTO_EVENT_NAMES_BY_CONTRACT)) {
      if (eventNames.length === 0) continue;
      const artifactPath = resolve("out", `${contractName}.sol`, `${contractName}.json`);
      if (!existsSync(artifactPath)) continue;
      const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { abi: AbiItem[] };
      const exportedAbi = FX_BENTO_ABIS[contractName as ContractName] as unknown as AbiItem[];

      for (const eventName of eventNames) {
        const artifactEvent = artifact.abi.find((item) => item.type === "event" && item.name === eventName);
        const exportedEvent = exportedAbi.find((item) => item.type === "event" && item.name === eventName);
        expect(exportedEvent).toBeDefined();
        expect(eventFingerprint(exportedEvent)).toEqual(eventFingerprint(artifactEvent));
      }
    }
  });

  test("exports validated deployment artifacts for live testnets", () => {
    const artifacts = [ARC_TESTNET_DEPLOYMENT, AVALANCHE_FUJI_DEPLOYMENT];

    for (const artifact of artifacts) {
      const factoryAddress = artifact.addresses.FXBentoRoomFactory;
      const escrowAddress = artifact.addresses.FXBentoRoomEscrow;
      const settlementAddress = artifact.addresses.FXBentoSettlementManager;
      const roundManagerAddress = artifact.addresses.FXBentoRoundManager;
      const hookAddress = artifact.addresses.FXBentoHook;
      const poolRegistryAddress = artifact.addresses.PoolRegistry;
      const poolManagerAddress = artifact.addresses.PoolManager;

      if (!factoryAddress || !escrowAddress || !settlementAddress || !roundManagerAddress || !hookAddress || !poolRegistryAddress || !poolManagerAddress) {
        throw new Error(`missing deployment address for chain ${artifact.chainId}`);
      }
      expect(DeploymentArtifactSchema.parse(artifact)).toEqual(artifact);
      expect(FX_BENTO_DEPLOYMENTS[artifact.chainId]).toEqual(artifact);
      expect(artifact.backendEnv.FX_BENTO_CHAIN_ID).toBe(String(artifact.chainId));
      expect(artifact.backendEnv.FX_BENTO_FROM_BLOCK).toBe(String(artifact.indexerStartBlock));
      expect(artifact.backendEnv.FX_BENTO_FACTORY_ADDRESS).toBe(factoryAddress);
      expect(artifact.backendEnv.FX_BENTO_ESCROW_ADDRESS).toBe(escrowAddress);
      expect(artifact.backendEnv.FX_BENTO_SETTLEMENT_ADDRESS).toBe(settlementAddress);
      expect(artifact.backendEnv.FX_BENTO_ROUND_MANAGER_ADDRESS).toBe(roundManagerAddress);
      expect(artifact.backendEnv.FX_BENTO_HOOK_ADDRESS).toBe(hookAddress);
      expect(artifact.backendEnv.FX_BENTO_POOL_REGISTRY_ADDRESS).toBe(poolRegistryAddress);
      expect(getDeploymentContractAddress(artifact.chainId, "PoolManager")).toBe(poolManagerAddress);
    }
  });

  test("maps FX_BENTO direct env aliases into chain-scoped contract config", () => {
    const addresses = chainContractAddressesFromEnv(ARC_TESTNET_DEPLOYMENT.backendEnv, ARC_TESTNET_DEPLOYMENT.chainId);
    const factory = ARC_TESTNET_DEPLOYMENT.addresses.FXBentoRoomFactory;
    const escrow = ARC_TESTNET_DEPLOYMENT.addresses.FXBentoRoomEscrow;
    const settlement = ARC_TESTNET_DEPLOYMENT.addresses.FXBentoSettlementManager;
    const roundManager = ARC_TESTNET_DEPLOYMENT.addresses.FXBentoRoundManager;
    const hook = ARC_TESTNET_DEPLOYMENT.addresses.FXBentoHook;
    const registry = ARC_TESTNET_DEPLOYMENT.addresses.PoolRegistry;

    if (!factory || !escrow || !settlement || !roundManager || !hook || !registry) {
      throw new Error("missing Arc deployment test fixture address");
    }

    expect(getContractAddress(addresses, "FXBentoRoomFactory", ARC_TESTNET_DEPLOYMENT.chainId)).toBe(
      factory
    );
    expect(getContractAddress(addresses, "FXBentoRoomEscrow", ARC_TESTNET_DEPLOYMENT.chainId)).toBe(
      escrow
    );
    expect(getContractAddress(addresses, "FXBentoSettlementManager", ARC_TESTNET_DEPLOYMENT.chainId)).toBe(
      settlement
    );
    expect(getContractAddress(addresses, "FXBentoRoundManager", ARC_TESTNET_DEPLOYMENT.chainId)).toBe(
      roundManager
    );
    expect(getContractAddress(addresses, "FXBentoHook", ARC_TESTNET_DEPLOYMENT.chainId)).toBe(
      hook
    );
    expect(getContractAddress(addresses, "PoolRegistry", ARC_TESTNET_DEPLOYMENT.chainId)).toBe(
      registry
    );
  });

  test("deployment JSON artifacts match typed exports", () => {
    const fixturePairs = [
      ["arc-testnet-5042002.json", ARC_TESTNET_DEPLOYMENT],
      ["avalanche-fuji-43113.json", AVALANCHE_FUJI_DEPLOYMENT],
    ] as const;

    for (const [filename, typedArtifact] of fixturePairs) {
      const artifactPath = resolve("packages/contracts/deployments", filename);
      const jsonArtifact = JSON.parse(readFileSync(artifactPath, "utf8"));
      expect(DeploymentArtifactSchema.parse(jsonArtifact)).toEqual(typedArtifact);
    }
  });

  test("deployment artifacts feed indexer defaults and allow env overrides", () => {
    const fujiFactory = AVALANCHE_FUJI_DEPLOYMENT.addresses.FXBentoRoomFactory;
    const fujiEscrow = AVALANCHE_FUJI_DEPLOYMENT.addresses.FXBentoRoomEscrow;
    const fujiSettlement = AVALANCHE_FUJI_DEPLOYMENT.addresses.FXBentoSettlementManager;
    const arcEscrow = ARC_TESTNET_DEPLOYMENT.addresses.FXBentoRoomEscrow;

    if (!fujiFactory || !fujiEscrow || !fujiSettlement || !arcEscrow) {
      throw new Error("missing deployment test fixture address");
    }

    const fujiAddresses = chainContractAddressesFromEnv({ FX_BENTO_CHAIN_ID: 43113 }, 43113);
    expect(getContractAddress(fujiAddresses, "FXBentoRoomFactory", 43113)).toBe(
      fujiFactory
    );
    expect(getContractAddress(fujiAddresses, "FXBentoRoomEscrow", 43113)).toBe(
      fujiEscrow
    );
    expect(getContractAddress(fujiAddresses, "FXBentoSettlementManager", 43113)).toBe(
      fujiSettlement
    );
    expect(resolveDeploymentRpcUrl({ FX_BENTO_CHAIN_ID: 43113 }, 43113)).toBe(AVALANCHE_FUJI_DEPLOYMENT.rpcUrl);
    expect(resolveDeploymentStartBlock({ FX_BENTO_CHAIN_ID: 43113 }, 43113)).toBe(
      AVALANCHE_FUJI_DEPLOYMENT.indexerStartBlock
    );

    const overrideFactory = "0x1111111111111111111111111111111111111111" as const;
    const arcAddresses = chainContractAddressesFromEnv(
      { FX_BENTO_CHAIN_ID: 5042002, FX_BENTO_FACTORY_ADDRESS: overrideFactory },
      5042002
    );
    expect(getContractAddress(arcAddresses, "FXBentoRoomFactory", 5042002)).toBe(overrideFactory);
    expect(getContractAddress(arcAddresses, "FXBentoRoomEscrow", 5042002)).toBe(
      arcEscrow
    );
    expect(resolveDeploymentRpcUrl({ FX_BENTO_RPC_URL: "https://rpc.example.test" }, 5042002)).toBe(
      "https://rpc.example.test"
    );
    expect(resolveDeploymentStartBlock({ FX_BENTO_FROM_BLOCK: 123 }, 5042002)).toBe(123);
  });
});

type AbiItem = {
  type: string;
  name?: string;
  inputs?: Array<{ name?: string; type: string; indexed?: boolean }>;
};

function eventFingerprint(item: AbiItem | undefined) {
  expect(item).toBeDefined();
  return {
    name: item?.name,
    inputs: item?.inputs?.map((input) => ({
      name: input.name,
      type: input.type,
      indexed: Boolean(input.indexed),
    })),
  };
}
