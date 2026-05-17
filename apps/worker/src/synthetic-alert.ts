import { createFxBentoPostgresPersistenceStore, createFxBentoSqlitePersistenceStore } from "@bufinance/fx-bento-db";
import { readEnv } from "@bufinance/fx-bento-env";
import { nowIso } from "@bufinance/fx-bento-shared-types";

import { dispatchOperatorAlerts } from "./alerts";
import {
  configureFxBentoJobStore,
  enqueueFxBentoJob,
  getFxBentoWorkerHealthSnapshot,
} from "./jobs";

async function main() {
  const env = readEnv();
  if (!env.OPERATOR_ALERT_WEBHOOK_URL) {
    throw new Error("OPERATOR_ALERT_WEBHOOK_URL is required to trigger a synthetic operator alert");
  }

  const databaseUrl = env.FX_BENTO_DATABASE_URL ?? env.PONDER_SQL_URL;
  const dbPath = env.FX_BENTO_DB_PATH ?? env.WORKER_JOB_STORE_PATH ?? `.fx-bento/fx-bento-${env.ENVIRONMENT}.sqlite`;
  configureFxBentoJobStore({
    store: databaseUrl
      ? createFxBentoPostgresPersistenceStore(databaseUrl)
      : createFxBentoSqlitePersistenceStore(dbPath),
  });

  const now = Date.now();
  const staleCheckedAt = new Date(now - (env.WORKER_STUCK_JOB_SECONDS + 60) * 1000).toISOString();
  const id = `synthetic-stuck:${env.ENVIRONMENT}:${now}`;
  await enqueueFxBentoJob({
    id,
    kind: "finalize_results",
    chainId: Number(process.env.PONDER_CHAIN_ID ?? 84532),
    roomId: `synthetic-${now}`,
    status: "running",
    attempts: 2,
    txHash: `0x${"5e".repeat(32)}`,
    confirmationStatus: "pending",
    lastError: "ponder_finalization_pending",
    lastCheckedAt: staleCheckedAt,
    createdAt: staleCheckedAt,
    updatedAt: staleCheckedAt,
    payload: {
      synthetic: true,
      ponderLagSeconds: env.WORKER_STUCK_JOB_SECONDS + 60,
      generatedAt: nowIso(),
    },
  });

  const jobHealth = await getFxBentoWorkerHealthSnapshot({
    stuckAfterMs: env.WORKER_STUCK_JOB_SECONDS * 1000,
    now: () => now,
  });
  const result = await dispatchOperatorAlerts({
    env,
    jobHealth,
    source: "operator_health",
    now: () => now,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.configured && result.dispatched > 0,
        syntheticJobId: id,
        alertSink: result,
        alertCount: jobHealth.alerts.length,
        stuckJobCount: jobHealth.stuckJobs.length,
      },
      null,
      2
    )
  );

  if (!result.configured || result.dispatched === 0 || result.lastError) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "synthetic_alert_failed");
  process.exitCode = 1;
});
