import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildSelectedTilesHash,
  buildSelectionCommitment,
  buildSettlementResultTree,
  configureFxBentoSettlementResultStore,
  resetFxBentoSettlementResultsForTests,
} from "@bufinance/fx-bento-game";
import { recordFxBentoContractEvent, resetPonderStateForTests } from "@bufinance/fx-bento-ponder";
import {
  configureFxBentoJobStore,
  enqueueFxBentoJob,
  listFxBentoJobs,
  pollFxBentoJobConfirmation,
  resetFxBentoJobsForTests,
} from "../../worker/src/jobs";
import { createApiApp } from "./app";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

type Artifact = {
  abi: Abi;
  bytecode: { object: Hex };
};

type PreparedTransaction = {
  to: Address;
  data: Hex;
  functionName: string;
  contractName: string;
};

const mnemonic = "test test test test test test test test test test test junk";
const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const alice = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const bob = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
);
const treasury = "0x0000000000000000000000000000000000000777" as const;
const quoteToken = "0x000000000000000000000000000000000000e00c" as const;
const oracle = "0x0000000000000000000000000000000000000a11" as const;
const gridHash = `0x${"67".repeat(32)}` as const;
const stateHash = `0x${"11".repeat(32)}` as const;
const nonce = `0x${"22".repeat(32)}` as const;
const rosterHash = `0x${"44".repeat(32)}` as const;
const leaderboardHash = `0x${"55".repeat(32)}` as const;
const scoreRoot = `0x${"66".repeat(32)}` as const;
const settlementPriceRoot = `0x${"77".repeat(32)}` as const;

let anvil: ReturnType<typeof Bun.spawn> | null = null;

// Requires forge + anvil binaries; run locally with `bun run test:anvil`
const describeAnvil = process.env.CI ? describe.skip : describe;
describeAnvil("FX Bento Anvil lifecycle", () => {
  beforeAll(async () => {
    resetPonderStateForTests();
    await resetFxBentoJobsForTests();
    await resetFxBentoSettlementResultsForTests();
  });

  afterAll(() => {
    if (anvil) anvil.kill();
  });

  test("deploys contracts, prepares API txs, simulates, replays events, and persists finalization", async () => {
    ensureArtifacts();
    const port = 19_000 + Math.floor(Math.random() * 1_000);
    const rpcUrl = `http://127.0.0.1:${port}`;
    anvil = Bun.spawn(
      ["anvil", "--host", "127.0.0.1", "--port", String(port), "--mnemonic", mnemonic, "--silent"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await waitForRpc(rpcUrl);

    const chain = defineChain({
      id: 31337,
      name: "anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ chain, transport: http(rpcUrl) });
    const receipts: TransactionReceipt[] = [];

    const deploy = async (artifactName: string, args: unknown[] = []) => {
      const artifact = artifactFor(artifactName);
      const hash = await walletClient.deployContract({
        account: owner,
        abi: artifact.abi,
        bytecode: artifact.bytecode.object,
        args,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      receipts.push(receipt);
      return getAddress(receipt.contractAddress as Address);
    };

    const usdc = await deploy("MockUSDC");
    const registry = await deploy("PoolRegistry", [owner.address]);
    const vault = await deploy("ProtocolFeeVault", [owner.address, treasury]);
    const hook = await deploy("MockFXBentoHook");
    const factory = await deploy("FXBentoRoomFactory", [owner.address, registry]);
    const escrow = await deploy("FXBentoRoomEscrow", [owner.address, factory, vault]);
    const rounds = await deploy("FXBentoRoundManager", [owner.address, factory, hook]);
    const commitments = await deploy("FXBentoCommitmentManager", [owner.address, rounds, escrow]);
    const settlement = await deploy("FXBentoSettlementManager", [owner.address, factory, escrow]);
    const addresses = {
      FXBentoRoomFactory: factory,
      FXBentoRoomEscrow: escrow,
      FXBentoRoundManager: rounds,
      FXBentoCommitmentManager: commitments,
      FXBentoSettlementManager: settlement,
      FXBentoHook: hook,
      PoolRegistry: registry,
      ProtocolFeeVault: vault,
    };

    const write = async (
      artifactName: string,
      address: Address,
      functionName: string,
      args: unknown[],
      account: PrivateKeyAccount = owner
    ) => {
      const artifact = artifactFor(artifactName);
      const hash = await walletClient.writeContract({
        account,
        address,
        abi: artifact.abi,
        functionName,
        args,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      receipts.push(receipt);
      return receipt;
    };

    const poolKey = {
      currency0: usdc,
      currency1: quoteToken,
      fee: 500,
      tickSpacing: 10,
      hooks: hook,
    };

    await write("PoolRegistry", registry, "setPool", [poolKey, oracle, true, 300]);
    await write("FXBentoRoomFactory", factory, "setEscrow", [escrow]);
    await write("FXBentoRoomFactory", factory, "setEntryToken", [usdc, true]);
    await write("FXBentoRoomEscrow", escrow, "setSettlementManager", [settlement]);
    await write("FXBentoSettlementManager", settlement, "setRoundManager", [rounds]);
    await write("FXBentoSettlementManager", settlement, "setChallengeWindow", [0]);
    await write("MockUSDC", usdc, "mint", [alice.address, 1_000_000_000n]);
    await write("MockUSDC", usdc, "mint", [bob.address, 1_000_000_000n]);
    await write("MockUSDC", usdc, "approve", [escrow, 1_000_000_000n], alice);
    await write("MockUSDC", usdc, "approve", [escrow, 1_000_000_000n], bob);

    const previousEnv = captureEnv();
    const storeDir = mkdtempSync(join(tmpdir(), "fx-bento-anvil-"));
    const dbPath = join(storeDir, "fx-bento.sqlite");
    configureFxBentoJobStore({ dbPath });
    configureFxBentoSettlementResultStore({ dbPath });
    process.env.CONTRACT_RPC_URL = rpcUrl;
    process.env.CONTRACT_ADDRESSES_JSON = JSON.stringify({ 31337: addresses });
    process.env.X402_NETWORK = "eip155:31337";
    process.env.SIMULATION_ACCOUNT_ADDRESS = owner.address;
    process.env.FX_BENTO_DB_PATH = dbPath;
    delete process.env.PONDER_GRAPHQL_URL;

    try {
      const app = createApiApp();
      const createBlock = await publicClient.getBlock();

      const roomConfig = {
        poolKey,
        entryToken: usdc,
        entryFee: "5000000",
        minPlayers: 2,
        maxPlayers: 2,
        rounds: 1,
        roundDuration: 120,
        lockBuffer: 30,
        startTime: Number(createBlock.timestamp) + 60,
        rakeBps: 1000,
        payoutBps: [10000],
        gridConfigHash: gridHash,
        isPrivate: false,
      };
      const createTx = await prepared(app, "/fx-bento/rooms", roomConfig);
      expect(createTx.safety.simulation.status).toBe("passed");
      receipts.push(await sendPrepared(publicClient, walletClient, owner, createTx.transaction));
      await replayReceipts(publicClient, receipts.splice(0), addresses);

      process.env.SIMULATION_ACCOUNT_ADDRESS = alice.address;
      const joinAlice = await prepared(app, "/fx-bento/rooms/1/join");
      expect(joinAlice.safety.reconciliation).toMatchObject({
        status: "passed",
        indexedStatus: "lobby",
        contractStatus: "lobby",
      });
      receipts.push(await sendPrepared(publicClient, walletClient, alice, joinAlice.transaction));

      process.env.SIMULATION_ACCOUNT_ADDRESS = bob.address;
      const joinBob = await prepared(app, "/fx-bento/rooms/1/join");
      expect(joinBob.safety.simulation.status).toBe("passed");
      receipts.push(await sendPrepared(publicClient, walletClient, bob, joinBob.transaction));
      await replayReceipts(publicClient, receipts.splice(0), addresses);

      await mineAfter(publicClient, 61);
      await write("FXBentoRoomEscrow", escrow, "lockRoom", [1n]);
      const block = await publicClient.getBlock();
      const startTime = Number(block.timestamp);
      await write("MockFXBentoHook", hook, "recordSnapshotForTesting", [poolKey, 1n << 96n, 100]);
      await write("FXBentoRoundManager", rounds, "startRound", [
        1n,
        0,
        BigInt(startTime),
        BigInt(startTime + 120),
        BigInt(startTime + 90),
        gridHash,
      ]);
      await replayReceipts(publicClient, receipts.splice(0), addresses);

      const selection = { rows: [2], cols: [4], chipCount: 1, clientStateHash: stateHash };
      const selectedTilesHash = buildSelectedTilesHash(selection);
      const commitment = buildSelectionCommitment({
        chainId: 31337,
        roomId: 1n,
        roundIndex: 0,
        player: alice.address,
        selectedTilesHash,
        nonce,
      });

      process.env.SIMULATION_ACCOUNT_ADDRESS = alice.address;
      const commitTx = await prepared(app, "/fx-bento/rooms/1/commit", { roundIndex: 0, commitment });
      expect(commitTx.safety).toMatchObject({
        reconciliation: { status: "passed", indexedStatus: "active", contractStatus: "active" },
        simulation: { status: "passed" },
      });
      receipts.push(await sendPrepared(publicClient, walletClient, alice, commitTx.transaction));

      await mineAfter(publicClient, 91);

      const revealTx = await prepared(app, "/fx-bento/rooms/1/reveal", { roundIndex: 0, selection, nonce });
      expect(revealTx.safety.simulation.status).toBe("passed");
      receipts.push(await sendPrepared(publicClient, walletClient, alice, revealTx.transaction));
      await mineAfter(publicClient, 31);
      await write("MockFXBentoHook", hook, "recordSnapshotForTesting", [poolKey, (1n << 96n) + 1_000_000n, 101]);
      await write("FXBentoRoundManager", rounds, "recordSettlement", [1n, 0]);
      await replayReceipts(publicClient, receipts.splice(0), addresses);

      const resultTree = buildSettlementResultTree(
        1n,
        [{ roomId: 1n, player: alice.address, amount: 9_000_000n, score: 100n, rank: 1 }],
        10_000_000n,
        1_000_000n
      );

      process.env.SIMULATION_ACCOUNT_ADDRESS = owner.address;
      const submitTx = await prepared(app, "/fx-bento/rooms/1/settle", {
        resultsRoot: resultTree.root,
        metadataURI: "ipfs://anvil-results",
        payout: {
          winnerRoot: resultTree.root,
          rosterHash,
          leaderboardHash,
          scoreRoot,
          settlementPriceRoot,
          payoutTotal: "9000000",
          protocolFee: "1000000",
        },
      });
      expect(submitTx.safety.simulation.status).toBe("passed");
      receipts.push(await sendPrepared(publicClient, walletClient, owner, submitTx.transaction));
      await replayReceipts(publicClient, receipts.splice(0), addresses);

      await mineAfter(publicClient, 601);
      const finalizeTx = await prepared(app, "/fx-bento/rooms/1/finalize");
      expect(finalizeTx.safety.reconciliation).toMatchObject({
        status: "passed",
        indexedStatus: "settling",
        contractStatus: "settling",
      });
      const finalizeReceipt = await sendPrepared(publicClient, walletClient, owner, finalizeTx.transaction);
      receipts.push(finalizeReceipt);
      await replayReceipts(publicClient, receipts.splice(0), addresses);

      const job = await enqueueFxBentoJob({
        kind: "finalize_results",
        chainId: 31337,
        roomId: "1",
        txHash: finalizeReceipt.transactionHash,
        payload: {
          resultsRoot: resultTree.root,
          metadataURI: "ipfs://anvil-results",
          protocolFee: "1000000",
          escrowedAmount: "10000000",
          allocations: [{ player: alice.address, amount: "9000000", score: "100", rank: 1 }],
        },
      });
      const confirmedJob = await pollFxBentoJobConfirmation(job.id, { confirmationClient: publicClient });
      expect(confirmedJob).toMatchObject({
        kind: "finalize_results",
        status: "completed",
        txHash: finalizeReceipt.transactionHash,
        confirmationStatus: "confirmed",
      });

      const claimProofResponse = await app.request(`/fx-bento/rooms/1/claims/${alice.address}`, undefined, {
        ENVIRONMENT: "test",
      });
      const claimProof = await claimProofResponse.json();
      expect(claimProof).toMatchObject({
        amount: "9000000",
        proofReady: true,
        claimable: true,
        settlementRoot: resultTree.root,
      });

      process.env.SIMULATION_ACCOUNT_ADDRESS = alice.address;
      const claimTx = await prepared(app, "/fx-bento/rooms/1/claim", {});
      expect(claimTx.safety).toMatchObject({
        reconciliation: { status: "passed", indexedStatus: "settled", contractStatus: "settled" },
        simulation: { status: "passed" },
      });
      receipts.push(await sendPrepared(publicClient, walletClient, alice, claimTx.transaction));
      await replayReceipts(publicClient, receipts.splice(0), addresses);

      const roomResponse = await app.request("/fx-bento/rooms/1", undefined, { ENVIRONMENT: "test" });
      const room = await roomResponse.json();
      expect(room).toMatchObject({
        status: "settled",
        playerCount: 2,
        settlementRoot: resultTree.root,
        results: { finalized: true, root: resultTree.root },
      });
      expect(room.players.find((player: { wallet: string }) => player.wallet === alice.address)).toMatchObject({
        prizeClaimedAmount: "9000000",
      });

      configureFxBentoJobStore({ dbPath });
      expect(await listFxBentoJobs()).toEqual([
        expect.objectContaining({ id: job.id, txHash: finalizeReceipt.transactionHash }),
      ]);
    } finally {
      restoreEnv(previousEnv);
      configureFxBentoJobStore({ filePath: null });
      configureFxBentoSettlementResultStore({ filePath: null });
      await resetFxBentoJobsForTests();
      await resetFxBentoSettlementResultsForTests();
    }
  }, 120_000);
});

async function prepared(app: ReturnType<typeof createApiApp>, path: string, body?: unknown) {
  const response = await app.request(
    path,
    body === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
        },
    { ENVIRONMENT: "test" }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    transaction: PreparedTransaction;
    safety: {
      simulation: { status: string };
      reconciliation: { status: string; indexedStatus?: string; contractStatus?: string };
    };
  };
}

async function sendPrepared(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: PrivateKeyAccount,
  transaction: PreparedTransaction
) {
  const hash = await walletClient.sendTransaction({
    account,
    chain: null,
    to: transaction.to,
    data: transaction.data,
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

async function replayReceipts(
  publicClient: ReturnType<typeof createPublicClient>,
  receipts: TransactionReceipt[],
  addresses: Record<string, Address>
) {
  const contracts = Object.entries(addresses).map(([contractName, address]) => ({
    contractName,
    address: address.toLowerCase(),
    abi: artifactFor(contractName).abi,
  }));
  for (const receipt of receipts) {
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    for (const log of receipt.logs) {
      const contract = contracts.find((item) => item.address === log.address.toLowerCase());
      if (!contract) continue;
      const parsed = parseEventLogs({ abi: contract.abi, logs: [log], strict: false })[0];
      if (!parsed) continue;
      try {
        recordFxBentoContractEvent({
          chainId: 31337,
          contractName: contract.contractName,
          eventName: parsed.eventName,
          args: parsed.args as Record<string, unknown>,
          txHash: receipt.transactionHash,
          logIndex: log.logIndex,
          blockNumber: receipt.blockNumber,
          blockTimestamp: block.timestamp,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith("unsupported_fx_bento_event:")) throw error;
      }
    }
  }
}

function artifactFor(contractName: string): Artifact {
  const path = resolve(`out/${contractName}.sol/${contractName}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

function ensureArtifacts() {
  if (existsSync(resolve("out/FXBentoRoomFactory.sol/FXBentoRoomFactory.json"))) return;
  const result = Bun.spawnSync(["forge", "build"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`forge build failed: ${result.stderr.toString()}`);
  }
}

async function waitForRpc(rpcUrl: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return;
    } catch {
      // Keep polling until Anvil opens the port.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("anvil_rpc_not_ready");
}

function captureEnv() {
  return {
    CONTRACT_RPC_URL: process.env.CONTRACT_RPC_URL,
    CONTRACT_ADDRESSES_JSON: process.env.CONTRACT_ADDRESSES_JSON,
    FX_BENTO_DB_PATH: process.env.FX_BENTO_DB_PATH,
    PONDER_GRAPHQL_URL: process.env.PONDER_GRAPHQL_URL,
    SETTLEMENT_RESULT_STORE_PATH: process.env.SETTLEMENT_RESULT_STORE_PATH,
    X402_NETWORK: process.env.X402_NETWORK,
    SIMULATION_ACCOUNT_ADDRESS: process.env.SIMULATION_ACCOUNT_ADDRESS,
    WORKER_JOB_STORE_PATH: process.env.WORKER_JOB_STORE_PATH,
  };
}

function restoreEnv(snapshot: ReturnType<typeof captureEnv>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function mineAfter(publicClient: ReturnType<typeof createPublicClient>, seconds: number) {
  await publicClient.request({ method: "evm_increaseTime" as never, params: [seconds] as never });
  await publicClient.request({ method: "evm_mine" as never });
}
