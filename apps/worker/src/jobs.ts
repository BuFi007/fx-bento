import {
  chainContractAddressesFromEnv,
  hasAnyContractAddress,
  resolveDeploymentRpcUrl,
} from "@bufinance/fx-bento-contracts";
import {
  createFxBentoMemoryPersistenceStore,
  createFxBentoPostgresPersistenceStore,
  createFxBentoSqlitePersistenceStore,
  type FxBentoPersistenceStore,
} from "@bufinance/fx-bento-db";
import { readEnv } from "@bufinance/fx-bento-env";
import {
  buildSettlementResultTree,
  Hex32Schema,
  prepareFinalizeResultsTransaction,
  prepareLockRoomTransaction,
  prepareRecordAnchorTransaction,
  prepareRecordSettlementTransaction,
  prepareStartRoundTransaction,
  prepareSubmitResultsTransaction,
  recordFxBentoSettlementFinalization,
  safetyCheckFxBentoTransaction,
  saveFxBentoSettlementResult,
  serializeTransactionRequest,
  SettlementPayoutRootSchema,
  type FxBentoContractEngineConfig,
  type FxBentoTransactionRequest,
} from "@bufinance/fx-bento-game";
import { ensureLiveblocksRoom, fxBentoArcadeRoom } from "@bufinance/fx-bento-liveblocks";
import {
  createPonderReadSource,
  inspectFxBentoIndexedRoom,
  type FxBentoRoomReadModel,
  type PonderReadSource,
} from "@bufinance/fx-bento-ponder";
import { AddressSchema, HexSchema, nowIso } from "@bufinance/fx-bento-shared-types";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

export const FxBentoJobKindSchema = z.enum([
  "lock_room",
  "start_round",
  "record_anchor",
  "record_settlement",
  "build_results",
  "submit_results",
  "finalize_results",
  "project_liveblocks",
  "reconcile_room",
]);

export const FxBentoJobSchema = z.object({
  id: z.string().min(1),
  kind: FxBentoJobKindSchema,
  chainId: z.coerce.number().int().positive().default(84532),
  roomId: z.string().min(1),
  roundIndex: z.coerce.number().int().nonnegative().optional(),
  payload: z.record(z.unknown()).default({}),
  status: z.enum(["queued", "running", "completed", "failed"]).default("queued"),
  attempts: z.number().int().nonnegative().default(0),
  txHash: z.string().optional(),
  confirmationStatus: z.enum(["pending", "confirmed", "failed"]).optional(),
  confirmedAt: z.string().optional(),
  nextAttemptAt: z.string().datetime().optional(),
  lastCheckedAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  createdAt: z.string().default(nowIso),
  updatedAt: z.string().default(nowIso),
});

export type FxBentoJobKind = z.infer<typeof FxBentoJobKindSchema>;
export type FxBentoJob = z.infer<typeof FxBentoJobSchema>;

export interface FxBentoConfirmationReceipt {
  transactionHash?: Hex;
  status?: "success" | "reverted";
  blockNumber?: bigint;
}

export interface FxBentoConfirmationClient {
  getTransactionReceipt: (args: { hash: Hex }) => Promise<FxBentoConfirmationReceipt | null>;
}

export interface FxBentoJobTransactionSubmitInput {
  job: FxBentoJob;
  request: FxBentoTransactionRequest;
}

export interface FxBentoLiveblocksProjectionInput {
  job: FxBentoJob;
  room: FxBentoRoomReadModel | null;
  projection: FxBentoLiveblocksProjection;
}

export interface FxBentoJobRunOptions {
  confirmationClient?: FxBentoConfirmationClient;
  contractEngine?: FxBentoContractEngineConfig;
  finalizeSubmitter?: (job: FxBentoJob) => Promise<{ txHash: Hex }>;
  transactionSubmitter?: (input: FxBentoJobTransactionSubmitInput) => Promise<{ txHash: Hex }>;
  liveblocksProjector?: (input: FxBentoLiveblocksProjectionInput) => Promise<Record<string, unknown> | void>;
  ponderReadSource?: Pick<PonderReadSource, "inspectFxBentoRoom" | "health">;
  requirePonderFinality?: boolean;
  retryPolicy?: Partial<FxBentoRetryPolicy>;
  now?: () => string;
}

export interface FxBentoRetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
}

export interface FxBentoLiveblocksProjection {
  liveblocksRoomId: string;
  status: FxBentoRoomReadModel["status"] | "missing";
  roomId: string;
  chainId: number;
  playerCount: number;
  countdownEndsAt: number | null;
  leaderboardPreview: Array<{ wallet: string; score: number }>;
  activeRound: number | null;
  projectedAt: string;
}

export interface FxBentoWorkerHealthAlert {
  code:
    | "failed_jobs"
    | "stuck_worker_jobs"
    | "pending_receipts"
    | "pending_ponder"
    | "remote_ponder_lag";
  severity: "warning" | "critical";
  message: string;
  count?: number;
  jobId?: string;
  kind?: FxBentoJobKind;
  roomId?: string;
  chainId?: number;
  ageSeconds?: number;
  lagSeconds?: number;
}

export interface FxBentoWorkerHealthSnapshot {
  status: "ok" | "pending" | "degraded";
  totalJobs: number;
  byStatus: Record<FxBentoJob["status"], number>;
  byKind: Partial<Record<FxBentoJobKind, number>>;
  pendingConfirmations: number;
  pendingReceiptCount: number;
  pendingPonderCount: number;
  failedJobs: number;
  dueJobs: number;
  nextDueJobAt: string | null;
  oldestPendingConfirmationAgeSeconds: number | null;
  maxPonderLagSeconds: number | null;
  alerts: FxBentoWorkerHealthAlert[];
  stuckJobs: Array<{
    id: string;
    kind: FxBentoJobKind;
    roomId: string;
    chainId: number;
    txHash?: string;
    lastError?: string;
    ageSeconds: number;
    nextAttemptAt?: string;
    ponderLagSeconds?: number;
  }>;
  stuckFinalizations: Array<{
    id: string;
    roomId: string;
    chainId: number;
    txHash?: string;
    lastError?: string;
    ageSeconds: number;
    nextAttemptAt?: string;
    ponderLagSeconds?: number;
  }>;
}

const DEFAULT_RETRY_POLICY: FxBentoRetryPolicy = {
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  maxAttempts: 8,
};

let jobStore: FxBentoPersistenceStore = createFxBentoMemoryPersistenceStore();

const BigNumberishSchema = z
  .union([z.bigint(), z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((value) => BigInt(value));

const FinalizeResultsPayloadSchema = z.object({
  resultsRoot: HexSchema.optional(),
  metadataURI: z.string().min(1).optional(),
  totalPrizePayouts: BigNumberishSchema.optional(),
  protocolFee: BigNumberishSchema.default(0n),
  escrowedAmount: BigNumberishSchema.optional(),
  allocations: z
    .array(
      z.object({
        player: AddressSchema,
        amount: BigNumberishSchema,
        score: BigNumberishSchema.default(0n),
        rank: z.coerce.number().int().positive().default(1),
      })
    )
    .optional(),
});

const StartRoundPayloadSchema = z.object({
  startTime: BigNumberishSchema,
  endTime: BigNumberishSchema,
  lockTime: BigNumberishSchema,
  gridConfigHash: Hex32Schema,
});

const PricePayloadSchema = z.object({
  price: BigNumberishSchema,
});

const SubmitResultsPayloadSchema = z.object({
  resultsRoot: Hex32Schema,
  metadataURI: z.string().min(1),
  payout: SettlementPayoutRootSchema,
  attestation: HexSchema.default("0x"),
});

const CONTRACT_JOB_KINDS = new Set<FxBentoJobKind>([
  "lock_room",
  "start_round",
  "record_anchor",
  "record_settlement",
  "submit_results",
  "finalize_results",
]);

export function configureFxBentoJobStore(
  args: {
    databaseUrl?: string | null;
    dbPath?: string | null;
    filePath?: string | null;
    store?: FxBentoPersistenceStore | null;
  } = {}
): void {
  if (args.store) {
    jobStore = args.store;
    return;
  }
  const dbPath = args.dbPath ?? args.filePath;
  jobStore = args.databaseUrl
    ? createFxBentoPostgresPersistenceStore(args.databaseUrl)
    : dbPath
      ? createFxBentoSqlitePersistenceStore(dbPath)
      : createFxBentoMemoryPersistenceStore();
}

export async function enqueueFxBentoJob(
  input: Omit<z.input<typeof FxBentoJobSchema>, "id"> & { id?: string }
): Promise<FxBentoJob> {
  const id = input.id ?? jobId(input.kind, input.chainId ?? 84532, input.roomId, input.roundIndex);
  const existing = await getFxBentoJob(id);
  if (existing && existing.status !== "failed") return existing;
  const job = FxBentoJobSchema.parse({ ...input, id });
  return await saveJob(job);
}

export async function listFxBentoJobs(): Promise<FxBentoJob[]> {
  return (await jobStore.listJobs()).map((job) => FxBentoJobSchema.parse(job));
}

export async function getFxBentoJob(id: string): Promise<FxBentoJob | null> {
  const job = await jobStore.getJob(id);
  return job ? FxBentoJobSchema.parse(job) : null;
}

export async function runFxBentoJob(id: string, options: FxBentoJobRunOptions = {}): Promise<FxBentoJob> {
  const job = await getFxBentoJob(id);
  if (!job) throw new Error("job_not_found");
  if (job.status === "completed") return job;
  const resolved = { ...createDefaultFxBentoJobRunOptions(job), ...options };
  job.status = "running";
  job.attempts += 1;
  job.updatedAt = nowIso();
  await saveJob(job);
  try {
    if (CONTRACT_JOB_KINDS.has(job.kind)) {
      return await runContractActionJob(job, resolved);
    }
    if (job.kind === "project_liveblocks") {
      return await runLiveblocksProjectionJob(job, resolved);
    }
    const room = await inspectRoomReadModel(job, resolved);
    if (!room && job.kind !== "reconcile_room") throw new Error("room_not_indexed");
    job.payload = {
      ...job.payload,
      indexedRoomStatus: room?.status ?? null,
      indexedPlayerCount: room?.playerCount ?? null,
    };
    job.status = "completed";
    job.updatedAt = nowIso();
    return saveJob(job);
  } catch (error) {
    return scheduleRetry(job, error, options);
  }
}

export async function pollFxBentoJobConfirmation(
  id: string,
  options: FxBentoJobRunOptions = {}
): Promise<FxBentoJob> {
  const job = await getFxBentoJob(id);
  if (!job) throw new Error("job_not_found");
  if (!job.txHash) throw new Error("job_tx_hash_missing");
  const resolved = { ...createDefaultFxBentoJobRunOptions(job), ...options };
  if (!resolved.confirmationClient) {
    job.status = "running";
    job.confirmationStatus = "pending";
    job.lastError = "confirmation_client_not_configured";
    return savePendingConfirmation(job, resolved, "confirmation_client_not_configured");
  }

  const receipt = await resolved.confirmationClient
    .getTransactionReceipt({ hash: job.txHash as Hex })
    .catch(() => null);
  if (!receipt) {
    return savePendingConfirmation(job, resolved, "receipt_not_available");
  }
  if (receipt.status && receipt.status !== "success") {
    return await recordFxBentoJobConfirmation(job.id, {
      txHash: job.txHash,
      confirmationStatus: "failed",
      confirmedAt: resolved.now?.() ?? nowIso(),
    });
  }

  if (job.kind === "finalize_results" || job.kind === "submit_results") {
    await persistSettlementResultFromJob(job, "submitted");
  }
  const ponderConfirmation = await checkPonderJobCompletion(job, resolved);
  if (!ponderConfirmation.ok) {
    return savePendingConfirmation(job, resolved, ponderConfirmation.reason, {
      ponderLagSeconds: ponderConfirmation.lagSeconds,
      ponderHealth: ponderConfirmation.health,
    });
  }
  const confirmed = await recordFxBentoJobConfirmation(job.id, {
    txHash: job.txHash,
    confirmationStatus: "confirmed",
    confirmedAt: resolved.now?.() ?? nowIso(),
  });
  if (confirmed.kind === "finalize_results") {
    await finalizeSettlementResultFromJob(confirmed, receipt.blockNumber);
  }
  return confirmed;
}

export async function drainFxBentoJobs(limit = 25): Promise<FxBentoJob[]> {
  const runnable = (await listFxBentoJobs())
    .filter(isRunnable)
    .slice(0, limit);
  const completed: FxBentoJob[] = [];
  for (const job of runnable) {
    completed.push(await runFxBentoJob(job.id));
  }
  return completed;
}

export async function recordFxBentoJobConfirmation(
  id: string,
  input: { txHash: string; confirmedAt?: string; confirmationStatus?: "confirmed" | "failed" }
): Promise<FxBentoJob> {
  const job = await getFxBentoJob(id);
  if (!job) throw new Error("job_not_found");
  job.txHash = input.txHash;
  job.confirmationStatus = input.confirmationStatus ?? "confirmed";
  job.confirmedAt = input.confirmedAt ?? nowIso();
  job.status = input.confirmationStatus === "failed" ? "failed" : "completed";
  job.updatedAt = nowIso();
  if (job.kind === "finalize_results" && job.confirmationStatus === "confirmed") {
    await persistSettlementResultFromJob(job, "submitted");
    await finalizeSettlementResultFromJob(job);
  }
  return await saveJob(job);
}

export async function resetFxBentoJobsForTests(): Promise<void> {
  await jobStore.clearJobs();
}

export async function getFxBentoWorkerHealthSnapshot(
  options: { stuckAfterMs?: number; ponderLagWarningSeconds?: number; now?: () => number } = {}
): Promise<FxBentoWorkerHealthSnapshot> {
  return buildFxBentoWorkerHealthSnapshot(await listFxBentoJobs(), options);
}

function jobId(kind: string, chainId: number, roomId: string, roundIndex?: number): string {
  return [chainId, roomId, roundIndex ?? "room", kind].join(":");
}

async function saveJob(job: FxBentoJob): Promise<FxBentoJob> {
  return FxBentoJobSchema.parse(await jobStore.saveJob(FxBentoJobSchema.parse(job)));
}

async function runContractActionJob(job: FxBentoJob, options: FxBentoJobRunOptions): Promise<FxBentoJob> {
  if (job.kind === "finalize_results" || job.kind === "submit_results") {
    await persistSettlementResultFromJob(job, job.txHash ? "submitted" : "built");
  }
  if (!job.txHash) {
    const request: FxBentoTransactionRequest | null = options.transactionSubmitter
      ? buildWorkerTransactionRequest(job, resolveContractEngine(job, options))
      : null;
    const submitted = options.transactionSubmitter
      ? await options.transactionSubmitter({ job, request: request as FxBentoTransactionRequest })
      : job.kind === "finalize_results" && options.finalizeSubmitter
        ? await options.finalizeSubmitter(job)
        : null;
    if (!submitted) {
      throw new Error(job.kind === "finalize_results" ? "finalize_submitter_not_configured" : "transaction_submitter_not_configured");
    }
    job.txHash = submitted.txHash;
    job.confirmationStatus = "pending";
    job.status = "running";
    job.payload = {
      ...job.payload,
      transactionRequest: request ? serializeTransactionRequest(request) : job.payload.transactionRequest,
    };
    job.updatedAt = nowIso();
    return await saveJob(job);
  }
  return pollFxBentoJobConfirmation(job.id, options);
}

async function runLiveblocksProjectionJob(job: FxBentoJob, options: FxBentoJobRunOptions): Promise<FxBentoJob> {
  const room = await inspectRoomReadModel(job, options);
  if (!room) throw new Error("room_not_indexed");
  const projection = buildLiveblocksProjection(job, room, options.now?.() ?? nowIso());
  const projected = await projectLiveblocksRoom(job, room, projection, options);
  job.payload = {
    ...job.payload,
    indexedRoomStatus: room.status,
    indexedPlayerCount: room.playerCount,
    liveblocksProjection: projection,
    liveblocksProjectionResult: projected ?? null,
  };
  job.status = "completed";
  job.updatedAt = nowIso();
  return await saveJob(job);
}

export function buildWorkerTransactionRequest(
  job: FxBentoJob,
  engine: FxBentoContractEngineConfig
): FxBentoTransactionRequest {
  switch (job.kind) {
    case "lock_room":
      return prepareLockRoomTransaction(engine, job.roomId);
    case "start_round": {
      const payload = StartRoundPayloadSchema.parse(job.payload);
      return prepareStartRoundTransaction(engine, {
        roomId: job.roomId,
        roundIndex: requireRoundIndex(job),
        startTime: payload.startTime,
        endTime: payload.endTime,
        lockTime: payload.lockTime,
        gridConfigHash: payload.gridConfigHash,
      });
    }
    case "record_anchor": {
      const payload = PricePayloadSchema.parse(job.payload);
      return prepareRecordAnchorTransaction(engine, {
        roomId: job.roomId,
        roundIndex: requireRoundIndex(job),
        price: payload.price,
      });
    }
    case "record_settlement": {
      return prepareRecordSettlementTransaction(engine, {
        roomId: job.roomId,
        roundIndex: requireRoundIndex(job),
      });
    }
    case "submit_results": {
      const payload = SubmitResultsPayloadSchema.parse(job.payload);
      return prepareSubmitResultsTransaction(engine, {
        roomId: job.roomId,
        resultsRoot: payload.resultsRoot,
        metadataURI: payload.metadataURI,
        payout: payload.payout,
        attestation: payload.attestation,
      });
    }
    case "finalize_results":
      return prepareFinalizeResultsTransaction(engine, job.roomId);
    default:
      throw new Error(`job_kind_has_no_transaction:${job.kind}`);
  }
}

function resolveContractEngine(job: FxBentoJob, options: FxBentoJobRunOptions): FxBentoContractEngineConfig {
  if (options.contractEngine) {
    if (options.contractEngine.chainId !== job.chainId) throw new Error("contract_engine_chain_mismatch");
    return options.contractEngine;
  }
  const env = readEnv();
  const addresses = chainContractAddressesFromEnv(env, job.chainId);
  if (!hasAnyContractAddress(addresses)) throw new Error("contract_addresses_not_configured");
  return {
    chainId: job.chainId,
    addresses,
  };
}

function requireRoundIndex(job: FxBentoJob): number {
  if (job.roundIndex === undefined) throw new Error("round_index_required");
  return job.roundIndex;
}

async function inspectRoomReadModel(
  job: Pick<FxBentoJob, "chainId" | "roomId">,
  options: FxBentoJobRunOptions
): Promise<FxBentoRoomReadModel | null> {
  if (options.ponderReadSource) {
    return options.ponderReadSource.inspectFxBentoRoom({ chainId: job.chainId, roomId: job.roomId });
  }
  return inspectFxBentoIndexedRoom({ chainId: job.chainId, roomId: job.roomId });
}

function buildLiveblocksProjection(
  job: FxBentoJob,
  room: FxBentoRoomReadModel,
  projectedAt: string
): FxBentoLiveblocksProjection {
  const activeRound = [...room.rounds].reverse().find((round) => round.status === "active") ?? null;
  return {
    liveblocksRoomId: fxBentoArcadeRoom(job.roomId),
    status: room.status,
    roomId: job.roomId,
    chainId: job.chainId,
    playerCount: room.playerCount,
    countdownEndsAt: activeRound ? dateMs(activeRound.lockTime ?? activeRound.endTime) : null,
    leaderboardPreview: room.players
      .filter((player) => player.status === "joined")
      .map((player) => ({ wallet: player.wallet, score: Number(player.prizeClaimedAmount ?? 0) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 20),
    activeRound: activeRound?.roundIndex ?? null,
    projectedAt,
  };
}

async function projectLiveblocksRoom(
  job: FxBentoJob,
  room: FxBentoRoomReadModel,
  projection: FxBentoLiveblocksProjection,
  options: FxBentoJobRunOptions
): Promise<Record<string, unknown> | void> {
  if (options.liveblocksProjector) {
    return await options.liveblocksProjector({ job, room, projection });
  }
  await ensureLiveblocksRoom({
    roomId: projection.liveblocksRoomId,
    title: `FX Bento Room ${job.roomId}`,
    url: `/fx-bento/rooms/${job.roomId}`,
  });
  return {
    ensured: Boolean(process.env.LIVEBLOCKS_SECRET_KEY),
    mode: process.env.LIVEBLOCKS_SECRET_KEY ? "liveblocks" : "dry_run",
    roomId: projection.liveblocksRoomId,
  };
}

function dateMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function persistSettlementResultFromJob(job: FxBentoJob, status: "built" | "submitted" | "finalized") {
  const parsed = FinalizeResultsPayloadSchema.safeParse(job.payload);
  if (!parsed.success || !parsed.data.allocations?.length) return null;
  const tree = buildSettlementResultTree(
    job.roomId,
    parsed.data.allocations.map((allocation) => ({ ...allocation, roomId: job.roomId })),
    parsed.data.escrowedAmount,
    parsed.data.protocolFee
  );
  if (parsed.data.resultsRoot && parsed.data.resultsRoot.toLowerCase() !== tree.root.toLowerCase()) {
    throw new Error("settlement_root_mismatch");
  }
  const totalPrizePayouts = parsed.data.totalPrizePayouts ?? tree.totalPrizePayouts;
  return await saveFxBentoSettlementResult({
    chainId: job.chainId,
    roomId: job.roomId,
    status,
    resultsRoot: tree.root,
    metadataURI: parsed.data.metadataURI,
    totalPrizePayouts: totalPrizePayouts.toString(),
    protocolFee: parsed.data.protocolFee.toString(),
    finalizationTxHash: status === "finalized" ? (job.txHash as Hex | undefined) : undefined,
    allocations: tree.allocations.map((allocation) => ({
      player: allocation.player,
      amount: allocation.amount.toString(),
      score: allocation.score.toString(),
      rank: allocation.rank,
      leaf: allocation.leaf,
      proof: allocation.proof,
    })),
  });
}

async function finalizeSettlementResultFromJob(job: FxBentoJob, blockNumber?: bigint): Promise<void> {
  if (!job.txHash) return;
  try {
    await persistSettlementResultFromJob(job, "submitted");
    await recordFxBentoSettlementFinalization({
      chainId: job.chainId,
      roomId: job.roomId,
      txHash: job.txHash as Hex,
      blockNumber,
      finalizedAt: job.confirmedAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "settlement_result_not_found") return;
    throw error;
  }
}

async function scheduleRetry(job: FxBentoJob, error: unknown, options: FxBentoJobRunOptions): Promise<FxBentoJob> {
  const policy = retryPolicy(options);
  const message = error instanceof Error ? error.message : "unknown_error";
  job.lastError = message;
  job.updatedAt = nowIso();
  if (job.attempts >= policy.maxAttempts) {
    job.status = "failed";
    return await saveJob(job);
  }
  job.status = "queued";
  job.nextAttemptAt = new Date(Date.now() + retryDelayMs(job.attempts, policy)).toISOString();
  return await saveJob(job);
}

async function savePendingConfirmation(
  job: FxBentoJob,
  options: FxBentoJobRunOptions,
  reason: string,
  payload: Record<string, unknown> = {}
): Promise<FxBentoJob> {
  job.status = "running";
  job.confirmationStatus = "pending";
  job.lastCheckedAt = options.now?.() ?? nowIso();
  job.lastError = reason;
  job.nextAttemptAt = new Date(Date.now() + retryDelayMs(Math.max(job.attempts, 1), retryPolicy(options))).toISOString();
  job.payload = {
    ...job.payload,
    confirmationPendingReason: reason,
    ...payload,
  };
  job.updatedAt = nowIso();
  return await saveJob(job);
}

function buildFxBentoWorkerHealthSnapshot(
  jobs: FxBentoJob[],
  options: { stuckAfterMs?: number; ponderLagWarningSeconds?: number; now?: () => number } = {}
): FxBentoWorkerHealthSnapshot {
  const now = options.now?.() ?? Date.now();
  const stuckAfterMs = options.stuckAfterMs ?? 10 * 60 * 1000;
  const ponderLagWarningSeconds = options.ponderLagWarningSeconds ?? 120;
  const byStatus: FxBentoWorkerHealthSnapshot["byStatus"] = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  const byKind: FxBentoWorkerHealthSnapshot["byKind"] = {};
  const dueJobs = jobs.filter(isRunnable).length;
  const nextDueJobAt = minIso(jobs.map((job) => job.nextAttemptAt).filter((value): value is string => Boolean(value)));
  const pendingJobs = jobs.filter((job) => job.confirmationStatus === "pending" || job.status === "running");
  const pendingReceiptJobs = pendingJobs.filter((job) => job.lastError === "receipt_not_available");
  const pendingPonderJobs = pendingJobs.filter((job) => job.lastError?.startsWith("ponder_"));
  const pendingAges = pendingJobs
    .map((job) => Math.max(0, Math.floor((now - Date.parse(job.lastCheckedAt ?? job.updatedAt ?? job.createdAt)) / 1000)))
    .filter(Number.isFinite);
  const maxPonderLagSeconds = maxNumber(
    jobs.map((job) => numberPayload(job.payload.ponderLagSeconds ?? nestedLag(job.payload.ponderHealth)))
  );

  for (const job of jobs) {
    byStatus[job.status] += 1;
    byKind[job.kind] = (byKind[job.kind] ?? 0) + 1;
  }

  const stuckJobs = pendingJobs
    .map((job) => {
      const ageSeconds = Math.max(
        0,
        Math.floor((now - Date.parse(job.lastCheckedAt ?? job.updatedAt ?? job.createdAt)) / 1000)
      );
      return {
        id: job.id,
        kind: job.kind,
        roomId: job.roomId,
        chainId: job.chainId,
        txHash: job.txHash,
        lastError: job.lastError,
        ageSeconds,
        nextAttemptAt: job.nextAttemptAt,
        ponderLagSeconds: numberPayload(job.payload.ponderLagSeconds ?? nestedLag(job.payload.ponderHealth)),
      };
    })
    .filter((job) => job.ageSeconds * 1000 >= stuckAfterMs);
  const stuckFinalizations = stuckJobs.filter((job) => job.kind === "finalize_results").map(({ kind: _kind, ...job }) => job);
  const alerts = buildWorkerHealthAlerts({
    byStatus,
    pendingReceiptJobs,
    pendingPonderJobs,
    stuckJobs,
    maxPonderLagSeconds,
    ponderLagWarningSeconds,
  });

  return {
    status: alerts.some((alert) => alert.severity === "critical")
      ? "degraded"
      : pendingJobs.length > 0 || alerts.length > 0
        ? "pending"
        : "ok",
    totalJobs: jobs.length,
    byStatus,
    byKind,
    pendingConfirmations: pendingJobs.length,
    pendingReceiptCount: pendingReceiptJobs.length,
    pendingPonderCount: pendingPonderJobs.length,
    failedJobs: byStatus.failed,
    dueJobs,
    nextDueJobAt,
    oldestPendingConfirmationAgeSeconds: maxNumber(pendingAges),
    maxPonderLagSeconds,
    alerts,
    stuckJobs,
    stuckFinalizations,
  };
}

function buildWorkerHealthAlerts(args: {
  byStatus: FxBentoWorkerHealthSnapshot["byStatus"];
  pendingReceiptJobs: FxBentoJob[];
  pendingPonderJobs: FxBentoJob[];
  stuckJobs: FxBentoWorkerHealthSnapshot["stuckJobs"];
  maxPonderLagSeconds: number | null;
  ponderLagWarningSeconds: number;
}): FxBentoWorkerHealthAlert[] {
  const alerts: FxBentoWorkerHealthAlert[] = [];
  if (args.byStatus.failed > 0) {
    alerts.push({
      code: "failed_jobs",
      severity: "critical",
      message: "One or more worker jobs failed.",
      count: args.byStatus.failed,
    });
  }
  if (args.pendingReceiptJobs.length > 0) {
    alerts.push({
      code: "pending_receipts",
      severity: "warning",
      message: "Worker jobs are waiting for transaction receipts.",
      count: args.pendingReceiptJobs.length,
    });
  }
  if (args.pendingPonderJobs.length > 0) {
    alerts.push({
      code: "pending_ponder",
      severity: "warning",
      message: "Worker jobs are waiting for Ponder to index confirmed transactions.",
      count: args.pendingPonderJobs.length,
    });
  }
  if (args.maxPonderLagSeconds !== null && args.maxPonderLagSeconds >= args.ponderLagWarningSeconds) {
    alerts.push({
      code: "remote_ponder_lag",
      severity: args.maxPonderLagSeconds >= args.ponderLagWarningSeconds * 5 ? "critical" : "warning",
      message: "Remote Ponder lag is above the operator warning threshold.",
      lagSeconds: args.maxPonderLagSeconds,
    });
  }
  for (const job of args.stuckJobs) {
    alerts.push({
      code: "stuck_worker_jobs",
      severity: "critical",
      message: "A worker confirmation has exceeded the stuck-job threshold.",
      jobId: job.id,
      kind: job.kind,
      roomId: job.roomId,
      chainId: job.chainId,
      ageSeconds: job.ageSeconds,
      lagSeconds: job.ponderLagSeconds,
    });
  }
  return alerts;
}

async function checkPonderJobCompletion(
  job: FxBentoJob,
  options: FxBentoJobRunOptions
): Promise<{ ok: true } | { ok: false; reason: string; lagSeconds?: number; health?: unknown }> {
  if (!options.requirePonderFinality) return { ok: true };
  if (!options.ponderReadSource) return { ok: false, reason: "ponder_read_source_not_configured" };
  const [health, room] = await Promise.all([
    options.ponderReadSource.health().catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "unknown_error",
    })),
    options.ponderReadSource.inspectFxBentoRoom({ chainId: job.chainId, roomId: job.roomId }).catch(() => null),
  ]);
  const completion = room ? hasExpectedPonderState(job, room) : { ok: false, reason: "ponder_room_pending" };
  if (completion.ok) return { ok: true };
  return {
    ok: false,
    reason: completion.reason,
    lagSeconds: room?.updatedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(room.updatedAt)) / 1000)) : undefined,
    health,
  };
}

function hasExpectedPonderState(job: FxBentoJob, room: FxBentoRoomReadModel): { ok: true } | { ok: false; reason: string } {
  switch (job.kind) {
    case "lock_room":
      return ["active", "settling", "settled"].includes(room.status)
        ? { ok: true }
        : { ok: false, reason: "ponder_lock_pending" };
    case "start_round": {
      const round = room.rounds.find((item) => item.roundIndex === requireRoundIndex(job));
      return round?.startTime ? { ok: true } : { ok: false, reason: "ponder_round_start_pending" };
    }
    case "record_anchor": {
      const round = room.rounds.find((item) => item.roundIndex === requireRoundIndex(job));
      return round?.anchorPrice !== null && round?.anchorPrice !== undefined
        ? { ok: true }
        : { ok: false, reason: "ponder_anchor_pending" };
    }
    case "record_settlement": {
      const round = room.rounds.find((item) => item.roundIndex === requireRoundIndex(job));
      return round?.settlementPrice !== null && round?.settlementPrice !== undefined
        ? { ok: true }
        : { ok: false, reason: "ponder_settlement_pending" };
    }
    case "submit_results": {
      const payload = SubmitResultsPayloadSchema.safeParse(job.payload);
      if (payload.success && room.results.root?.toLowerCase() === payload.data.resultsRoot.toLowerCase()) return { ok: true };
      return { ok: false, reason: "ponder_results_pending" };
    }
    case "finalize_results":
      return room.results.finalized ? { ok: true } : { ok: false, reason: "ponder_finalization_pending" };
    default:
      return { ok: true };
  }
}

function isRunnable(job: FxBentoJob): boolean {
  const statusRunnable =
    job.status === "queued" ||
    (job.status === "running" && job.confirmationStatus === "pending");
  if (!statusRunnable) return false;
  if (!job.nextAttemptAt) return true;
  return Date.parse(job.nextAttemptAt) <= Date.now();
}

function minIso(values: string[]): string | null {
  const timestamps = values
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return timestamps[0] === undefined ? null : new Date(timestamps[0]).toISOString();
}

function maxNumber(values: Array<number | undefined | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length === 0 ? null : Math.max(...numbers);
}

function numberPayload(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function nestedLag(value: unknown): unknown {
  return value && typeof value === "object" && "lagSeconds" in value
    ? (value as { lagSeconds?: unknown }).lagSeconds
    : undefined;
}

function retryPolicy(options: FxBentoJobRunOptions): FxBentoRetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };
}

function retryDelayMs(attempts: number, policy: FxBentoRetryPolicy): number {
  const delay = policy.baseDelayMs * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, policy.maxDelayMs);
}

function createDefaultFxBentoJobRunOptions(job: FxBentoJob): FxBentoJobRunOptions {
  const env = readEnv();
  const rpcUrl = resolveDeploymentRpcUrl(env, job.chainId) ?? env.MARKET_DATA_RPC_URL;
  const ponderReadSource = env.PONDER_GRAPHQL_URL || env.PONDER_SQL_URL
    ? createPonderReadSource({ graphqlUrl: env.PONDER_GRAPHQL_URL, sqlUrl: env.PONDER_SQL_URL })
    : undefined;
  const addresses = chainContractAddressesFromEnv(env, job.chainId);
  const contractEngine = hasAnyContractAddress(addresses)
    ? {
        chainId: job.chainId,
        addresses,
      }
    : undefined;
  if (!rpcUrl) {
    return {
      contractEngine,
      ponderReadSource,
      requirePonderFinality: Boolean(env.PONDER_GRAPHQL_URL || env.PONDER_SQL_URL),
    };
  }
  const chain = defineChain({
    id: job.chainId,
    name: `fx-bento-worker-${job.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const transactionSubmitter = env.API_SIGNER_PRIVATE_KEY
    ? async ({ job: queuedJob, request }: FxBentoJobTransactionSubmitInput) => {
        if (!contractEngine) throw new Error("contract_addresses_not_configured");
        const account = privateKeyToAccount(env.API_SIGNER_PRIVATE_KEY as Hex);
        const indexedRoom = ponderReadSource
          ? await ponderReadSource
              .inspectFxBentoRoom({ chainId: queuedJob.chainId, roomId: queuedJob.roomId })
              .catch(() => null)
          : inspectFxBentoIndexedRoom({ chainId: queuedJob.chainId, roomId: queuedJob.roomId });
        await safetyCheckFxBentoTransaction({
          engine: contractEngine,
          request,
          roomId: queuedJob.roomId,
          indexedRoom,
          client: publicClient as never,
          account: account.address,
        });
        const walletClient = createWalletClient({ chain, transport: http(rpcUrl) });
        const txHash = await walletClient.sendTransaction({
          account,
          chain: null,
          to: request.to,
          data: request.data,
        });
        return { txHash };
      }
    : undefined;
  return {
    confirmationClient: publicClient as never,
    contractEngine,
    transactionSubmitter,
    ponderReadSource,
    requirePonderFinality: Boolean(env.PONDER_GRAPHQL_URL || env.PONDER_SQL_URL),
  };
}
