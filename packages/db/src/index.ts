import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import postgres from "postgres";

type MaybePromise<T> = T | Promise<T>;
type PostgresClient = ReturnType<typeof postgres>;

export interface MemoryTable<T extends { id: string }> {
  all(): T[];
  get(id: string): T | null;
  set(record: T): T;
  delete(id: string): boolean;
  clear(): void;
}

export interface FxBentoStoredJob {
  id: string;
  kind: string;
  chainId: number;
  roomId: string;
  roundIndex?: number;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  txHash?: string;
  confirmationStatus?: "pending" | "confirmed" | "failed";
  confirmedAt?: string;
  nextAttemptAt?: string;
  lastCheckedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FxBentoStoredSettlementAllocation {
  player: `0x${string}`;
  amount: string;
  score: string;
  rank: number;
  leaf: `0x${string}`;
  proof: `0x${string}`[];
}

export interface FxBentoStoredSettlementResult {
  id: string;
  chainId: number;
  roomId: string;
  status: "built" | "submitted" | "finalized" | "challenged";
  resultsRoot: `0x${string}`;
  metadataURI?: string;
  totalPrizePayouts: string;
  protocolFee: string;
  submitTxHash?: `0x${string}`;
  finalizationTxHash?: `0x${string}`;
  finalizedAt?: string;
  finalizedBlockNumber?: string;
  allocations: FxBentoStoredSettlementAllocation[];
  createdAt: string;
  updatedAt: string;
}

export interface FxBentoStoredX402Receipt {
  id: string;
  payer: string;
  amount: string;
  network: string;
  settlementRef: string;
  toolName?: string;
  requestMethod?: string;
  requestPath?: string;
  status?: "verified" | "rejected";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface FxBentoPersistenceStore {
  kind: "memory" | "sqlite" | "postgres";
  listJobs(): MaybePromise<FxBentoStoredJob[]>;
  getJob(id: string): MaybePromise<FxBentoStoredJob | null>;
  saveJob(job: FxBentoStoredJob): MaybePromise<FxBentoStoredJob>;
  clearJobs(): MaybePromise<void>;
  listSettlementResults(): MaybePromise<FxBentoStoredSettlementResult[]>;
  getSettlementResult(id: string): MaybePromise<FxBentoStoredSettlementResult | null>;
  saveSettlementResult(result: FxBentoStoredSettlementResult): MaybePromise<FxBentoStoredSettlementResult>;
  clearSettlementResults(): MaybePromise<void>;
  listX402Receipts(): MaybePromise<FxBentoStoredX402Receipt[]>;
  getX402Receipt(id: string): MaybePromise<FxBentoStoredX402Receipt | null>;
  saveX402Receipt(receipt: FxBentoStoredX402Receipt): MaybePromise<FxBentoStoredX402Receipt>;
  clearX402Receipts(): MaybePromise<void>;
}

export function createMemoryTable<T extends { id: string }>(seed: T[] = []): MemoryTable<T> {
  const table = new Map(seed.map((item) => [item.id, item]));
  return {
    all: () => [...table.values()],
    get: (id) => table.get(id) ?? null,
    set(record) {
      table.set(record.id, record);
      return record;
    },
    delete: (id) => table.delete(id),
    clear: () => table.clear(),
  };
}

export function createFxBentoMemoryPersistenceStore(): FxBentoPersistenceStore {
  const jobs = createMemoryTable<FxBentoStoredJob>();
  const settlementResults = createMemoryTable<FxBentoStoredSettlementResult>();
  const receipts = createMemoryTable<FxBentoStoredX402Receipt>();
  return {
    kind: "memory",
    listJobs: () => jobs.all(),
    getJob: (id) => jobs.get(id),
    saveJob: (job) => jobs.set(job),
    clearJobs: () => jobs.clear(),
    listSettlementResults: () => settlementResults.all(),
    getSettlementResult: (id) => settlementResults.get(id),
    saveSettlementResult: (result) => settlementResults.set(result),
    clearSettlementResults: () => settlementResults.clear(),
    listX402Receipts: () => receipts.all(),
    getX402Receipt: (id) => receipts.get(id),
    saveX402Receipt: (receipt) => receipts.set(receipt),
    clearX402Receipts: () => receipts.clear(),
  };
}

export function createFxBentoSqlitePersistenceStore(path: string): FxBentoPersistenceStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(`
    create table if not exists fx_bento_worker_jobs (
      id text primary key,
      kind text not null,
      chain_id integer not null,
      room_id text not null,
      round_index integer,
      payload_json text not null,
      status text not null,
      attempts integer not null,
      tx_hash text,
      confirmation_status text,
      confirmed_at text,
      next_attempt_at text,
      last_checked_at text,
      last_error text,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists fx_bento_worker_jobs_due_idx
      on fx_bento_worker_jobs(status, next_attempt_at);
    create index if not exists fx_bento_worker_jobs_room_idx
      on fx_bento_worker_jobs(chain_id, room_id);

    create table if not exists fx_bento_settlement_results (
      id text primary key,
      chain_id integer not null,
      room_id text not null,
      status text not null,
      results_root text not null,
      metadata_uri text,
      total_prize_payouts text not null,
      protocol_fee text not null,
      submit_tx_hash text,
      finalization_tx_hash text,
      finalized_at text,
      finalized_block_number text,
      allocations_json text not null,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists fx_bento_settlement_results_room_idx
      on fx_bento_settlement_results(chain_id, room_id);
    create index if not exists fx_bento_settlement_results_status_idx
      on fx_bento_settlement_results(status);

    create table if not exists fx_bento_x402_receipts (
      id text primary key,
      payer text not null,
      amount text not null,
      network text not null,
      settlement_ref text not null,
      tool_name text,
      request_method text,
      request_path text,
      status text not null,
      metadata_json text not null,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists fx_bento_x402_receipts_tool_idx
      on fx_bento_x402_receipts(tool_name);
    create index if not exists fx_bento_x402_receipts_created_idx
      on fx_bento_x402_receipts(created_at);
  `);

  const selectJobs = db.query<Record<string, unknown>, []>("select * from fx_bento_worker_jobs order by created_at asc");
  const selectJob = db.query<Record<string, unknown>, [string]>("select * from fx_bento_worker_jobs where id = ?");
  const upsertJob = db.query(`
    insert into fx_bento_worker_jobs (
      id, kind, chain_id, room_id, round_index, payload_json, status, attempts, tx_hash,
      confirmation_status, confirmed_at, next_attempt_at, last_checked_at, last_error, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      kind = excluded.kind,
      chain_id = excluded.chain_id,
      room_id = excluded.room_id,
      round_index = excluded.round_index,
      payload_json = excluded.payload_json,
      status = excluded.status,
      attempts = excluded.attempts,
      tx_hash = excluded.tx_hash,
      confirmation_status = excluded.confirmation_status,
      confirmed_at = excluded.confirmed_at,
      next_attempt_at = excluded.next_attempt_at,
      last_checked_at = excluded.last_checked_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `);
  const clearJobs = db.query("delete from fx_bento_worker_jobs");

  const selectResults = db.query<Record<string, unknown>, []>(
    "select * from fx_bento_settlement_results order by created_at asc"
  );
  const selectResult = db.query<Record<string, unknown>, [string]>(
    "select * from fx_bento_settlement_results where id = ?"
  );
  const upsertResult = db.query(`
    insert into fx_bento_settlement_results (
      id, chain_id, room_id, status, results_root, metadata_uri, total_prize_payouts,
      protocol_fee, submit_tx_hash, finalization_tx_hash, finalized_at,
      finalized_block_number, allocations_json, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      chain_id = excluded.chain_id,
      room_id = excluded.room_id,
      status = excluded.status,
      results_root = excluded.results_root,
      metadata_uri = excluded.metadata_uri,
      total_prize_payouts = excluded.total_prize_payouts,
      protocol_fee = excluded.protocol_fee,
      submit_tx_hash = excluded.submit_tx_hash,
      finalization_tx_hash = excluded.finalization_tx_hash,
      finalized_at = excluded.finalized_at,
      finalized_block_number = excluded.finalized_block_number,
      allocations_json = excluded.allocations_json,
      updated_at = excluded.updated_at
  `);
  const clearResults = db.query("delete from fx_bento_settlement_results");

  const selectReceipts = db.query<Record<string, unknown>, []>(
    "select * from fx_bento_x402_receipts order by created_at desc"
  );
  const selectReceipt = db.query<Record<string, unknown>, [string]>("select * from fx_bento_x402_receipts where id = ?");
  const upsertReceipt = db.query(`
    insert into fx_bento_x402_receipts (
      id, payer, amount, network, settlement_ref, tool_name, request_method,
      request_path, status, metadata_json, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      payer = excluded.payer,
      amount = excluded.amount,
      network = excluded.network,
      settlement_ref = excluded.settlement_ref,
      tool_name = excluded.tool_name,
      request_method = excluded.request_method,
      request_path = excluded.request_path,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const clearReceipts = db.query("delete from fx_bento_x402_receipts");

  return {
    kind: "sqlite",
    listJobs: () => selectJobs.all().map(rowToJob).filter((job): job is FxBentoStoredJob => job !== null),
    getJob: (id) => rowToJob(selectJob.get(id)),
    saveJob(job) {
      upsertJob.run(
        job.id,
        job.kind,
        job.chainId,
        job.roomId,
        job.roundIndex ?? null,
        JSON.stringify(job.payload ?? {}),
        job.status,
        job.attempts,
        job.txHash ?? null,
        job.confirmationStatus ?? null,
        job.confirmedAt ?? null,
        job.nextAttemptAt ?? null,
        job.lastCheckedAt ?? null,
        job.lastError ?? null,
        job.createdAt,
        job.updatedAt
      );
      return job;
    },
    clearJobs: () => {
      clearJobs.run();
    },
    listSettlementResults: () =>
      selectResults
        .all()
        .map(rowToSettlementResult)
        .filter((result): result is FxBentoStoredSettlementResult => result !== null),
    getSettlementResult: (id) => rowToSettlementResult(selectResult.get(id)),
    saveSettlementResult(result) {
      upsertResult.run(
        result.id,
        result.chainId,
        result.roomId,
        result.status,
        result.resultsRoot,
        result.metadataURI ?? null,
        result.totalPrizePayouts,
        result.protocolFee,
        result.submitTxHash ?? null,
        result.finalizationTxHash ?? null,
        result.finalizedAt ?? null,
        result.finalizedBlockNumber ?? null,
        JSON.stringify(result.allocations),
        result.createdAt,
        result.updatedAt
      );
      return result;
    },
    clearSettlementResults: () => {
      clearResults.run();
    },
    listX402Receipts: () =>
      selectReceipts
        .all()
        .map(rowToX402Receipt)
        .filter((receipt): receipt is FxBentoStoredX402Receipt => receipt !== null),
    getX402Receipt: (id) => rowToX402Receipt(selectReceipt.get(id)),
    saveX402Receipt(receipt) {
      upsertReceipt.run(
        receipt.id,
        receipt.payer,
        receipt.amount,
        receipt.network,
        receipt.settlementRef,
        receipt.toolName ?? null,
        receipt.requestMethod ?? null,
        receipt.requestPath ?? null,
        receipt.status ?? "verified",
        JSON.stringify(receipt.metadata ?? {}),
        receipt.createdAt,
        receipt.updatedAt ?? receipt.createdAt
      );
      return receipt;
    },
    clearX402Receipts: () => {
      clearReceipts.run();
    },
  };
}

export function createFxBentoPostgresPersistenceStore(databaseUrl: string): FxBentoPersistenceStore {
  const sql = postgres(databaseUrl, { max: 5, prepare: false });
  let schemaReady: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaReady ??= ensurePostgresSchema(sql);
    return schemaReady;
  };

  return {
    kind: "postgres",
    async listJobs() {
      await ensureSchema();
      const rows = await sql`select * from fx_bento_worker_jobs order by created_at asc`;
      return toRows(rows).map(rowToJob).filter((job): job is FxBentoStoredJob => job !== null);
    },
    async getJob(id) {
      await ensureSchema();
      const rows = await sql`select * from fx_bento_worker_jobs where id = ${id} limit 1`;
      return rowToJob(toRows(rows)[0] ?? null);
    },
    async saveJob(job) {
      await ensureSchema();
      await sql`
        insert into fx_bento_worker_jobs (
          id, kind, chain_id, room_id, round_index, payload_json, status, attempts, tx_hash,
          confirmation_status, confirmed_at, next_attempt_at, last_checked_at, last_error, created_at, updated_at
        ) values (
          ${job.id}, ${job.kind}, ${job.chainId}, ${job.roomId}, ${job.roundIndex ?? null},
          ${JSON.stringify(job.payload ?? {})}::jsonb, ${job.status}, ${job.attempts}, ${job.txHash ?? null},
          ${job.confirmationStatus ?? null}, ${job.confirmedAt ?? null}, ${job.nextAttemptAt ?? null},
          ${job.lastCheckedAt ?? null}, ${job.lastError ?? null}, ${job.createdAt}, ${job.updatedAt}
        )
        on conflict(id) do update set
          kind = excluded.kind,
          chain_id = excluded.chain_id,
          room_id = excluded.room_id,
          round_index = excluded.round_index,
          payload_json = excluded.payload_json,
          status = excluded.status,
          attempts = excluded.attempts,
          tx_hash = excluded.tx_hash,
          confirmation_status = excluded.confirmation_status,
          confirmed_at = excluded.confirmed_at,
          next_attempt_at = excluded.next_attempt_at,
          last_checked_at = excluded.last_checked_at,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `;
      return job;
    },
    async clearJobs() {
      await ensureSchema();
      await sql`delete from fx_bento_worker_jobs`;
    },
    async listSettlementResults() {
      await ensureSchema();
      const rows = await sql`select * from fx_bento_settlement_results order by created_at asc`;
      return toRows(rows)
        .map(rowToSettlementResult)
        .filter((result): result is FxBentoStoredSettlementResult => result !== null);
    },
    async getSettlementResult(id) {
      await ensureSchema();
      const rows = await sql`select * from fx_bento_settlement_results where id = ${id} limit 1`;
      return rowToSettlementResult(toRows(rows)[0] ?? null);
    },
    async saveSettlementResult(result) {
      await ensureSchema();
      await sql`
        insert into fx_bento_settlement_results (
          id, chain_id, room_id, status, results_root, metadata_uri, total_prize_payouts,
          protocol_fee, submit_tx_hash, finalization_tx_hash, finalized_at,
          finalized_block_number, allocations_json, created_at, updated_at
        ) values (
          ${result.id}, ${result.chainId}, ${result.roomId}, ${result.status}, ${result.resultsRoot},
          ${result.metadataURI ?? null}, ${result.totalPrizePayouts}, ${result.protocolFee},
          ${result.submitTxHash ?? null}, ${result.finalizationTxHash ?? null}, ${result.finalizedAt ?? null},
          ${result.finalizedBlockNumber ?? null}, ${JSON.stringify(result.allocations)}::jsonb, ${result.createdAt}, ${result.updatedAt}
        )
        on conflict(id) do update set
          chain_id = excluded.chain_id,
          room_id = excluded.room_id,
          status = excluded.status,
          results_root = excluded.results_root,
          metadata_uri = excluded.metadata_uri,
          total_prize_payouts = excluded.total_prize_payouts,
          protocol_fee = excluded.protocol_fee,
          submit_tx_hash = excluded.submit_tx_hash,
          finalization_tx_hash = excluded.finalization_tx_hash,
          finalized_at = excluded.finalized_at,
          finalized_block_number = excluded.finalized_block_number,
          allocations_json = excluded.allocations_json,
          updated_at = excluded.updated_at
      `;
      return result;
    },
    async clearSettlementResults() {
      await ensureSchema();
      await sql`delete from fx_bento_settlement_results`;
    },
    async listX402Receipts() {
      await ensureSchema();
      const rows = await sql`select * from fx_bento_x402_receipts order by created_at desc`;
      return toRows(rows)
        .map(rowToX402Receipt)
        .filter((receipt): receipt is FxBentoStoredX402Receipt => receipt !== null);
    },
    async getX402Receipt(id) {
      await ensureSchema();
      const rows = await sql`select * from fx_bento_x402_receipts where id = ${id} limit 1`;
      return rowToX402Receipt(toRows(rows)[0] ?? null);
    },
    async saveX402Receipt(receipt) {
      await ensureSchema();
      await sql`
        insert into fx_bento_x402_receipts (
          id, payer, amount, network, settlement_ref, tool_name, request_method,
          request_path, status, metadata_json, created_at, updated_at
        ) values (
          ${receipt.id}, ${receipt.payer}, ${receipt.amount}, ${receipt.network}, ${receipt.settlementRef},
          ${receipt.toolName ?? null}, ${receipt.requestMethod ?? null}, ${receipt.requestPath ?? null},
          ${receipt.status ?? "verified"}, ${JSON.stringify(receipt.metadata ?? {})}::jsonb, ${receipt.createdAt},
          ${receipt.updatedAt ?? receipt.createdAt}
        )
        on conflict(id) do update set
          payer = excluded.payer,
          amount = excluded.amount,
          network = excluded.network,
          settlement_ref = excluded.settlement_ref,
          tool_name = excluded.tool_name,
          request_method = excluded.request_method,
          request_path = excluded.request_path,
          status = excluded.status,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `;
      return receipt;
    },
    async clearX402Receipts() {
      await ensureSchema();
      await sql`delete from fx_bento_x402_receipts`;
    },
  };
}

async function ensurePostgresSchema(sql: PostgresClient): Promise<void> {
  await sql`
    create table if not exists fx_bento_worker_jobs (
      id text primary key,
      kind text not null,
      chain_id integer not null,
      room_id text not null,
      round_index integer,
      payload_json jsonb not null default '{}'::jsonb,
      status text not null,
      attempts integer not null,
      tx_hash text,
      confirmation_status text,
      confirmed_at text,
      next_attempt_at text,
      last_checked_at text,
      last_error text,
      created_at text not null,
      updated_at text not null
    )
  `;
  await sql`create index if not exists fx_bento_worker_jobs_due_idx on fx_bento_worker_jobs(status, next_attempt_at)`;
  await sql`create index if not exists fx_bento_worker_jobs_room_idx on fx_bento_worker_jobs(chain_id, room_id)`;

  await sql`
    create table if not exists fx_bento_settlement_results (
      id text primary key,
      chain_id integer not null,
      room_id text not null,
      status text not null,
      results_root text not null,
      metadata_uri text,
      total_prize_payouts text not null,
      protocol_fee text not null,
      submit_tx_hash text,
      finalization_tx_hash text,
      finalized_at text,
      finalized_block_number text,
      allocations_json jsonb not null default '[]'::jsonb,
      created_at text not null,
      updated_at text not null
    )
  `;
  await sql`create index if not exists fx_bento_settlement_results_room_idx on fx_bento_settlement_results(chain_id, room_id)`;
  await sql`create index if not exists fx_bento_settlement_results_status_idx on fx_bento_settlement_results(status)`;

  await sql`
    create table if not exists fx_bento_x402_receipts (
      id text primary key,
      payer text not null,
      amount text not null,
      network text not null,
      settlement_ref text not null,
      tool_name text,
      request_method text,
      request_path text,
      status text not null default 'verified',
      metadata_json jsonb not null default '{}'::jsonb,
      created_at text not null,
      updated_at text not null
    )
  `;
  await sql`create index if not exists fx_bento_x402_receipts_tool_idx on fx_bento_x402_receipts(tool_name)`;
  await sql`create index if not exists fx_bento_x402_receipts_created_idx on fx_bento_x402_receipts(created_at)`;
}

function rowToJob(row: Record<string, unknown> | null): FxBentoStoredJob | null {
  if (!row) return null;
  return {
    id: String(row.id),
    kind: String(row.kind),
    chainId: Number(row.chain_id),
    roomId: String(row.room_id),
    roundIndex: row.round_index === null || row.round_index === undefined ? undefined : Number(row.round_index),
    payload: parseJsonRecord(row.payload_json),
    status: row.status as FxBentoStoredJob["status"],
    attempts: Number(row.attempts),
    txHash: optionalString(row.tx_hash),
    confirmationStatus: optionalString(row.confirmation_status) as FxBentoStoredJob["confirmationStatus"],
    confirmedAt: optionalString(row.confirmed_at),
    nextAttemptAt: optionalString(row.next_attempt_at),
    lastCheckedAt: optionalString(row.last_checked_at),
    lastError: optionalString(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToSettlementResult(row: Record<string, unknown> | null): FxBentoStoredSettlementResult | null {
  if (!row) return null;
  return {
    id: String(row.id),
    chainId: Number(row.chain_id),
    roomId: String(row.room_id),
    status: row.status as FxBentoStoredSettlementResult["status"],
    resultsRoot: String(row.results_root) as `0x${string}`,
    metadataURI: optionalString(row.metadata_uri),
    totalPrizePayouts: String(row.total_prize_payouts),
    protocolFee: String(row.protocol_fee),
    submitTxHash: optionalString(row.submit_tx_hash) as `0x${string}` | undefined,
    finalizationTxHash: optionalString(row.finalization_tx_hash) as `0x${string}` | undefined,
    finalizedAt: optionalString(row.finalized_at),
    finalizedBlockNumber: optionalString(row.finalized_block_number),
    allocations: parseJsonArray(row.allocations_json) as FxBentoStoredSettlementAllocation[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToX402Receipt(row: Record<string, unknown> | null): FxBentoStoredX402Receipt | null {
  if (!row) return null;
  return {
    id: String(row.id),
    payer: String(row.payer),
    amount: String(row.amount),
    network: String(row.network),
    settlementRef: String(row.settlement_ref),
    toolName: optionalString(row.tool_name),
    requestMethod: optionalString(row.request_method),
    requestPath: optionalString(row.request_path),
    status: (optionalString(row.status) ?? "verified") as FxBentoStoredX402Receipt["status"],
    metadata: parseJsonRecord(row.metadata_json),
    createdAt: String(row.created_at),
    updatedAt: optionalString(row.updated_at),
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
