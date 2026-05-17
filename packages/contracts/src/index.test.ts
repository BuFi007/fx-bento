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
  getDeploymentContractAddress,
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
      const poolManagerAddress = artifact.addresses.PoolManager;

      if (!factoryAddress || !escrowAddress || !settlementAddress || !poolManagerAddress) {
        throw new Error(`missing deployment address for chain ${artifact.chainId}`);
      }
      expect(DeploymentArtifactSchema.parse(artifact)).toEqual(artifact);
      expect(FX_BENTO_DEPLOYMENTS[artifact.chainId]).toEqual(artifact);
      expect(artifact.backendEnv.FX_BENTO_CHAIN_ID).toBe(String(artifact.chainId));
      expect(artifact.backendEnv.FX_BENTO_FROM_BLOCK).toBe(String(artifact.indexerStartBlock));
      expect(artifact.backendEnv.FX_BENTO_FACTORY_ADDRESS).toBe(factoryAddress);
      expect(artifact.backendEnv.FX_BENTO_ESCROW_ADDRESS).toBe(escrowAddress);
      expect(artifact.backendEnv.FX_BENTO_SETTLEMENT_ADDRESS).toBe(settlementAddress);
      expect(getDeploymentContractAddress(artifact.chainId, "PoolManager")).toBe(poolManagerAddress);
    }
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
