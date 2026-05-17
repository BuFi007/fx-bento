import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordFxBentoContractEvent, resetPonderStateForTests } from "@bufinance/fx-bento-ponder";
import {
  configureFxBentoSettlementResultStore,
  getFxBentoClaimProof,
  listFxBentoSettlementResults,
  resetFxBentoSettlementResultsForTests,
} from "@bufinance/fx-bento-game";

import {
  configureFxBentoJobStore,
  enqueueFxBentoJob,
  getFxBentoWorkerHealthSnapshot,
  listFxBentoJobs,
  pollFxBentoJobConfirmation,
  recordFxBentoJobConfirmation,
  resetFxBentoJobsForTests,
  runFxBentoJob,
  type FxBentoJobTransactionSubmitInput,
} from "./jobs";

const txHash = `0x${"ab".repeat(32)}` as `0x${string}`;
const alice = "0x0000000000000000000000000000000000000a11" as const;
const gridHash = `0x${"11".repeat(32)}` as const;
const resultsRoot = `0x${"22".repeat(32)}` as const;
const payoutRoot = {
  winnerRoot: resultsRoot,
  rosterHash: `0x${"33".repeat(32)}` as const,
  leaderboardHash: `0x${"44".repeat(32)}` as const,
  scoreRoot: `0x${"55".repeat(32)}` as const,
  settlementPriceRoot: `0x${"66".repeat(32)}` as const,
  payoutTotal: "9000000",
  protocolFee: "1000000",
};
const contractEngine = {
  chainId: 31337,
  addresses: {
    FXBentoRoomEscrow: "0x0000000000000000000000000000000000000001",
    FXBentoRoundManager: "0x0000000000000000000000000000000000000002",
    FXBentoSettlementManager: "0x0000000000000000000000000000000000000003",
  },
} as const;

describe("FX Bento worker jobs", () => {
  beforeEach(async () => {
    configureFxBentoJobStore({ filePath: null });
    configureFxBentoSettlementResultStore({ filePath: null });
    await resetFxBentoJobsForTests();
    await resetFxBentoSettlementResultsForTests();
    resetPonderStateForTests();
  });

  test("dedupes jobs by chain room round and kind", async () => {
    const first = await enqueueFxBentoJob({ kind: "reconcile_room", chainId: 84532, roomId: "1" });
    const second = await enqueueFxBentoJob({ kind: "reconcile_room", chainId: 84532, roomId: "1" });
    expect(second.id).toBe(first.id);
  });

  test("runs a queued job against indexed room state", async () => {
    recordFxBentoContractEvent({
      contractName: "FXBentoRoomFactory",
      eventName: "RoomCreated",
      txHash,
      logIndex: 1,
      blockNumber: 1n,
      args: {
        roomId: 1n,
        poolId: `0x${"12".repeat(32)}`,
        entryToken: "0x0000000000000000000000000000000000000001",
        entryFee: 5_000_000n,
      },
    });
    const job = await enqueueFxBentoJob({ kind: "project_liveblocks", chainId: 84532, roomId: "1" });
    const completed = await runFxBentoJob(job.id);
    expect(completed).toMatchObject({
      status: "completed",
      payload: { indexedRoomStatus: "lobby", indexedPlayerCount: 0 },
    });
  });

  test("projects indexed room state into a Liveblocks payload", async () => {
    recordFxBentoContractEvent({
      contractName: "FXBentoRoomFactory",
      eventName: "RoomCreated",
      txHash,
      logIndex: 1,
      blockNumber: 1n,
      args: {
        roomId: 1n,
        poolId: `0x${"12".repeat(32)}`,
        entryToken: "0x0000000000000000000000000000000000000001",
        entryFee: 5_000_000n,
      },
    });
    recordFxBentoContractEvent({
      contractName: "FXBentoRoomEscrow",
      eventName: "RoomJoined",
      txHash,
      logIndex: 2,
      blockNumber: 2n,
      args: { roomId: 1n, player: alice },
    });
    recordFxBentoContractEvent({
      contractName: "FXBentoRoundManager",
      eventName: "RoundStarted",
      txHash,
      logIndex: 3,
      blockNumber: 3n,
      args: { roomId: 1n, roundIndex: 0, startTime: 100n, lockTime: 200n, endTime: 300n },
    });
    const job = await enqueueFxBentoJob({ kind: "project_liveblocks", chainId: 84532, roomId: "1" });
    const projected: unknown[] = [];

    const completed = await runFxBentoJob(job.id, {
      liveblocksProjector: async ({ projection }) => {
        projected.push(projection);
        return { projected: true };
      },
      now: () => "2026-05-17T00:00:00.000Z",
    });

    expect(completed).toMatchObject({
      status: "completed",
      payload: {
        liveblocksProjection: {
          liveblocksRoomId: "arcade:fx-bento:1",
          playerCount: 1,
          activeRound: 0,
          countdownEndsAt: 200_000,
        },
        liveblocksProjectionResult: { projected: true },
      },
    });
    expect(projected).toHaveLength(1);
  });

  test("persists jobs to a durable sqlite store", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "fx-bento-worker-")), "worker.sqlite");
    configureFxBentoJobStore({ dbPath });
    const job = await enqueueFxBentoJob({ kind: "reconcile_room", chainId: 84532, roomId: "1" });
    expect(existsSync(dbPath)).toBe(true);
    expect(await listFxBentoJobs()).toEqual([expect.objectContaining({ id: job.id })]);

    configureFxBentoJobStore({ dbPath });
    const deduped = await enqueueFxBentoJob({ kind: "reconcile_room", chainId: 84532, roomId: "1" });
    expect(deduped.id).toBe(job.id);
  });

  test("persists finalize result confirmation hashes", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "fx-bento-worker-")), "worker.sqlite");
    configureFxBentoJobStore({ dbPath });
    const job = await enqueueFxBentoJob({ kind: "finalize_results", chainId: 84532, roomId: "1" });
    const confirmed = await recordFxBentoJobConfirmation(job.id, { txHash });
    expect(confirmed).toMatchObject({
      status: "completed",
      txHash,
      confirmationStatus: "confirmed",
    });
    expect(await listFxBentoJobs()).toContainEqual(expect.objectContaining({ id: job.id, txHash, confirmationStatus: "confirmed" }));
  });

  test("polls finalize confirmations and makes claim proofs ready", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fx-bento-worker-"));
    const dbPath = join(dir, "worker.sqlite");
    configureFxBentoJobStore({ dbPath });
    configureFxBentoSettlementResultStore({ dbPath });
    const job = await enqueueFxBentoJob({
      kind: "finalize_results",
      chainId: 31337,
      roomId: "1",
      txHash,
      payload: {
        protocolFee: "1000000",
        escrowedAmount: "10000000",
        allocations: [{ player: alice, amount: "9000000", score: "100", rank: 1 }],
      },
    });

    const confirmed = await pollFxBentoJobConfirmation(job.id, {
      confirmationClient: {
        getTransactionReceipt: async () => ({ transactionHash: txHash, status: "success", blockNumber: 42n }),
      },
      now: () => "2026-05-17T00:00:00.000Z",
    });

    expect(confirmed).toMatchObject({
      status: "completed",
      txHash,
      confirmationStatus: "confirmed",
      confirmedAt: "2026-05-17T00:00:00.000Z",
    });
    expect(await getFxBentoClaimProof({ chainId: 31337, roomId: "1", player: alice })).toMatchObject({
      amount: "9000000",
      proof: [],
      proofReady: true,
      finalized: true,
    });
    expect(await listFxBentoSettlementResults()).toEqual([
      expect.objectContaining({
        chainId: 31337,
        roomId: "1",
        status: "finalized",
        finalizationTxHash: txHash,
      }),
    ]);
  });

  test("submits finalize jobs and leaves them pending confirmation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fx-bento-worker-"));
    const dbPath = join(dir, "worker.sqlite");
    configureFxBentoJobStore({ dbPath });
    configureFxBentoSettlementResultStore({ dbPath });
    const job = await enqueueFxBentoJob({
      kind: "finalize_results",
      chainId: 31337,
      roomId: "1",
      payload: {
        protocolFee: "1000000",
        escrowedAmount: "10000000",
        allocations: [{ player: alice, amount: "9000000", score: "100", rank: 1 }],
      },
    });

    const submitted = await runFxBentoJob(job.id, {
      finalizeSubmitter: async () => ({ txHash }),
      confirmationClient: undefined,
    });

    expect(submitted).toMatchObject({
      status: "running",
      txHash,
      confirmationStatus: "pending",
    });
    expect(await getFxBentoClaimProof({ chainId: 31337, roomId: "1", player: alice })).toMatchObject({
      amount: "9000000",
      proofReady: true,
      finalized: false,
    });
  });

  test("submits room and round lifecycle jobs with hardened transaction requests", async () => {
    const submitted: string[] = [];
    const submitter = async ({ request }: FxBentoJobTransactionSubmitInput) => {
      submitted.push(`${request.contractName}.${request.functionName}`);
      return { txHash };
    };
    const jobs = [
      await enqueueFxBentoJob({ kind: "lock_room", chainId: 31337, roomId: "1" }),
      await enqueueFxBentoJob({
        kind: "start_round",
        chainId: 31337,
        roomId: "1",
        roundIndex: 0,
        payload: { startTime: "100", endTime: "200", lockTime: "150", gridConfigHash: gridHash },
      }),
      await enqueueFxBentoJob({
        kind: "record_anchor",
        chainId: 31337,
        roomId: "1",
        roundIndex: 0,
        payload: { price: "100000000" },
      }),
      await enqueueFxBentoJob({
        kind: "record_settlement",
        chainId: 31337,
        roomId: "1",
        roundIndex: 0,
        payload: { price: "101000000" },
      }),
      await enqueueFxBentoJob({
        kind: "submit_results",
        chainId: 31337,
        roomId: "1",
        payload: { resultsRoot, metadataURI: "ipfs://results", payout: payoutRoot, attestation: "0x" },
      }),
    ];

    for (const job of jobs) {
      const submittedJob = await runFxBentoJob(job.id, {
        contractEngine,
        transactionSubmitter: submitter,
      });
      expect(submittedJob).toMatchObject({
        status: "running",
        txHash,
        confirmationStatus: "pending",
      });
      expect(submittedJob.payload.transactionRequest).toMatchObject({
        functionName: expect.any(String),
        data: expect.stringMatching(/^0x/),
      });
    }

    expect(submitted).toEqual([
      "FXBentoRoomEscrow.lockRoom",
      "FXBentoRoundManager.startRound",
      "FXBentoRoundManager.recordAnchor",
      "FXBentoRoundManager.recordSettlement",
      "FXBentoSettlementManager.submitResults",
    ]);
  });

  test("backs off finalize jobs when the submitter is not ready", async () => {
    const job = await enqueueFxBentoJob({
      kind: "finalize_results",
      chainId: 31337,
      roomId: "1",
      payload: {
        protocolFee: "1000000",
        escrowedAmount: "10000000",
        allocations: [{ player: alice, amount: "9000000", score: "100", rank: 1 }],
      },
    });

    const retried = await runFxBentoJob(job.id, {
      retryPolicy: { baseDelayMs: 1_000, maxDelayMs: 1_000, maxAttempts: 2 },
    });

    expect(retried).toMatchObject({
      status: "queued",
      attempts: 1,
      lastError: "finalize_submitter_not_configured",
    });
    expect(typeof retried.nextAttemptAt).toBe("string");
  });

  test("waits for remote Ponder finalization before completing confirmation", async () => {
    const job = await enqueueFxBentoJob({
      kind: "finalize_results",
      chainId: 31337,
      roomId: "1",
      txHash,
      payload: {
        protocolFee: "1000000",
        escrowedAmount: "10000000",
        allocations: [{ player: alice, amount: "9000000", score: "100", rank: 1 }],
      },
    });
    const stalePonder = {
      health: async () => ({ status: "remote" as const, endpoint: "http://ponder.test", ok: true }),
      inspectFxBentoRoom: async () => ({
        id: "31337:1",
        chainId: 31337,
        roomId: "1",
        poolId: null,
        entryToken: null,
        entryFee: null,
        marketId: null,
        status: "settled" as const,
        playerCount: 1,
        players: [],
        escrowedAmount: null,
        protocolFee: null,
        settlementRoot: null,
        results: {
          root: null,
          metadataURI: null,
          challenged: false,
          finalized: false,
          submittedAt: null,
          finalizedAt: null,
        },
        rounds: [],
        updatedAt: "2026-05-17T00:00:00.000Z",
      }),
    };

    const pending = await pollFxBentoJobConfirmation(job.id, {
      confirmationClient: {
        getTransactionReceipt: async () => ({ transactionHash: txHash, status: "success", blockNumber: 42n }),
      },
      ponderReadSource: stalePonder,
      requirePonderFinality: true,
      retryPolicy: { baseDelayMs: 1_000, maxDelayMs: 1_000, maxAttempts: 3 },
    });

    expect(pending).toMatchObject({
      status: "running",
      confirmationStatus: "pending",
      lastError: "ponder_finalization_pending",
    });
    expect(typeof pending.nextAttemptAt).toBe("string");

    const freshPonder = {
      ...stalePonder,
      inspectFxBentoRoom: async () => ({
        ...(await stalePonder.inspectFxBentoRoom()),
        results: {
          root: null,
          metadataURI: null,
          challenged: false,
          finalized: true,
          submittedAt: null,
          finalizedAt: "2026-05-17T00:01:00.000Z",
        },
      }),
    };

    const confirmed = await pollFxBentoJobConfirmation(job.id, {
      confirmationClient: {
        getTransactionReceipt: async () => ({ transactionHash: txHash, status: "success", blockNumber: 42n }),
      },
      ponderReadSource: freshPonder,
      requirePonderFinality: true,
      now: () => "2026-05-17T00:02:00.000Z",
    });
    expect(confirmed).toMatchObject({
      status: "completed",
      confirmationStatus: "confirmed",
      confirmedAt: "2026-05-17T00:02:00.000Z",
    });
  });

  test("waits for submit_results to appear in Ponder before completing confirmation", async () => {
    const job = await enqueueFxBentoJob({
      kind: "submit_results",
      chainId: 31337,
      roomId: "1",
      txHash,
      payload: { resultsRoot, metadataURI: "ipfs://results", payout: payoutRoot, attestation: "0x" },
    });
    const baseRoom = {
      id: "31337:1",
      chainId: 31337,
      roomId: "1",
      poolId: null,
      entryToken: null,
      entryFee: null,
      marketId: null,
      status: "active" as const,
      playerCount: 1,
      players: [],
      escrowedAmount: null,
      protocolFee: null,
      settlementRoot: null,
      results: {
        root: null,
        metadataURI: null,
        challenged: false,
        finalized: false,
        submittedAt: null,
        finalizedAt: null,
      },
      rounds: [],
      updatedAt: "2026-05-17T00:00:00.000Z",
    };
    const stalePonder = {
      health: async () => ({ status: "remote" as const, endpoint: "http://ponder.test", ok: true }),
      inspectFxBentoRoom: async () => baseRoom,
    };

    const pending = await pollFxBentoJobConfirmation(job.id, {
      confirmationClient: {
        getTransactionReceipt: async () => ({ transactionHash: txHash, status: "success", blockNumber: 42n }),
      },
      ponderReadSource: stalePonder,
      requirePonderFinality: true,
      retryPolicy: { baseDelayMs: 1_000, maxDelayMs: 1_000, maxAttempts: 3 },
    });

    expect(pending).toMatchObject({
      status: "running",
      confirmationStatus: "pending",
      lastError: "ponder_results_pending",
    });

    const freshPonder = {
      ...stalePonder,
      inspectFxBentoRoom: async () => ({
        ...baseRoom,
        status: "settling" as const,
        settlementRoot: resultsRoot,
        results: { ...baseRoom.results, root: resultsRoot, metadataURI: "ipfs://results" },
        updatedAt: "2026-05-17T00:01:00.000Z",
      }),
    };

    const confirmed = await pollFxBentoJobConfirmation(job.id, {
      confirmationClient: {
        getTransactionReceipt: async () => ({ transactionHash: txHash, status: "success", blockNumber: 43n }),
      },
      ponderReadSource: freshPonder,
      requirePonderFinality: true,
      now: () => "2026-05-17T00:02:00.000Z",
    });
    expect(confirmed).toMatchObject({
      status: "completed",
      confirmationStatus: "confirmed",
      confirmedAt: "2026-05-17T00:02:00.000Z",
    });
  });

  test("reports pending Ponder lag and stuck finalizations for operator health", async () => {
    await enqueueFxBentoJob({
      id: "stuck-finalize",
      kind: "finalize_results",
      chainId: 31337,
      roomId: "1",
      txHash,
      status: "running",
      confirmationStatus: "pending",
      attempts: 2,
      lastError: "ponder_finalization_pending",
      lastCheckedAt: "2026-05-17T00:00:00.000Z",
      nextAttemptAt: "2026-05-17T00:10:00.000Z",
      payload: {
        ponderLagSeconds: 75,
      },
    });

    const health = await getFxBentoWorkerHealthSnapshot({
      now: () => Date.parse("2026-05-17T00:20:00.000Z"),
      stuckAfterMs: 5 * 60 * 1000,
    });

    expect(health).toMatchObject({
      status: "degraded",
      totalJobs: 1,
      pendingConfirmations: 1,
      pendingPonderCount: 1,
      maxPonderLagSeconds: 75,
      alerts: [
        expect.objectContaining({ code: "pending_ponder", severity: "warning", count: 1 }),
        expect.objectContaining({ code: "stuck_worker_jobs", severity: "critical", jobId: "stuck-finalize" }),
      ],
      stuckJobs: [{ id: "stuck-finalize", kind: "finalize_results", roomId: "1", ageSeconds: 1200 }],
      stuckFinalizations: [{ id: "stuck-finalize", roomId: "1", ageSeconds: 1200 }],
    });
  });
});
