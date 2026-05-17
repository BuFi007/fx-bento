import { readEnv } from "@bufinance/fx-bento-env";
import { configureFxBentoSettlementResultStore, listFxBentoSettlementResults } from "@bufinance/fx-bento-game";
import { createPonderReadSource } from "@bufinance/fx-bento-ponder";
import { createLogger } from "@bufinance/logger";
import { createCorsMiddleware, errorHandler, notFoundHandler, requestContext } from "@bufinance/worker-base";
import { Hono, type Context, type Next } from "hono";

import { dispatchOperatorAlerts } from "./alerts";
import {
  configureFxBentoJobStore,
  drainFxBentoJobs,
  enqueueFxBentoJob,
  getFxBentoJob,
  getFxBentoWorkerHealthSnapshot,
  listFxBentoJobs,
} from "./jobs";

const log = createLogger({ prefix: "fx-bento:worker" });

export function createWorkerApp() {
  const env = readEnv();
  const app = new Hono();
  const databaseUrl = env.FX_BENTO_DATABASE_URL ?? env.PONDER_SQL_URL;
  const dbPath = databaseUrl
    ? undefined
    : env.FX_BENTO_DB_PATH ?? env.WORKER_JOB_STORE_PATH ?? `.fx-bento/fx-bento-${env.ENVIRONMENT}.sqlite`;
  configureFxBentoJobStore({
    databaseUrl,
    dbPath,
  });
  configureFxBentoSettlementResultStore({
    databaseUrl,
    dbPath: databaseUrl ? undefined : env.FX_BENTO_DB_PATH ?? env.SETTLEMENT_RESULT_STORE_PATH ?? dbPath,
  });

  app.use("*", requestContext());
  app.use(
    "*",
    createCorsMiddleware({
      origins: {
        development: ["http://localhost:3000", "http://localhost:3001", "http://localhost:8787"],
        preview: ["*"],
        staging: ["*"],
        production: ["*"],
        test: ["*"],
      },
      fallbackEnv: env.ENVIRONMENT,
      headers: {
        allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Request-Id"],
        exposeHeaders: ["X-Request-Id", "X-Response-Time"],
      },
    })
  );

  app.get("/health", async (c) => {
    const [jobHealth, settlementResults, indexer] = await Promise.all([
      getFxBentoWorkerHealthSnapshot({ stuckAfterMs: workerStuckAfterMs(env) }),
      listFxBentoSettlementResults(),
      env.PONDER_GRAPHQL_URL ? createPonderReadSource({ graphqlUrl: env.PONDER_GRAPHQL_URL }).health() : null,
    ]);
    const alertSink = await dispatchOperatorAlerts({ env, jobHealth, indexer, source: "health" });
    return c.json({
      ok: jobHealth.status !== "degraded",
      service: "fx-bento-worker",
      persistence: databaseUrl ? "postgres" : "sqlite",
      jobHealth,
      operator: operatorHealthFields(jobHealth),
      alertSink,
      jobs: jobHealth.totalJobs,
      settlementResults: settlementResults.length,
      indexer,
      environment: env.ENVIRONMENT,
    });
  });

  app.use("/jobs", requireWorkerAuth(env));
  app.use("/jobs/*", requireWorkerAuth(env));
  app.use("/settlement-results", requireWorkerAuth(env));
  app.use("/settlement-results/*", requireWorkerAuth(env));
  app.use("/operator", requireWorkerAuth(env));
  app.use("/operator/*", requireWorkerAuth(env));

  app.get("/jobs", async (c) => c.json({ jobs: await listFxBentoJobs() }));

  app.post("/jobs", async (c) => {
    const body = await c.req.json();
    const job = await enqueueFxBentoJob(body);
    log.info({ jobId: job.id, kind: job.kind, roomId: job.roomId }, "FX Bento job queued");
    return c.json(job, 201);
  });

  app.get("/jobs/:id", async (c) => {
    const job = await getFxBentoJob(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "job_not_found" }, 404);
  });

  app.post("/jobs/:id/run", async (c) => {
    const { runFxBentoJob } = await import("./jobs");
    return c.json(await runFxBentoJob(c.req.param("id")));
  });

  app.post("/jobs/drain", async (c) => {
    const jobs = await drainFxBentoJobs();
    const [jobHealth, indexer] = await Promise.all([
      getFxBentoWorkerHealthSnapshot({ stuckAfterMs: workerStuckAfterMs(env) }),
      env.PONDER_GRAPHQL_URL ? createPonderReadSource({ graphqlUrl: env.PONDER_GRAPHQL_URL }).health() : null,
    ]);
    return c.json({
      jobs,
      operator: operatorHealthFields(jobHealth),
      alertSink: await dispatchOperatorAlerts({ env, jobHealth, indexer, source: "jobs_drain" }),
    });
  });

  app.get("/settlement-results", async (c) => c.json({ results: await listFxBentoSettlementResults() }));

  app.get("/operator/health", async (c) => {
    const [jobHealth, indexer] = await Promise.all([
      getFxBentoWorkerHealthSnapshot({ stuckAfterMs: workerStuckAfterMs(env) }),
      env.PONDER_GRAPHQL_URL ? createPonderReadSource({ graphqlUrl: env.PONDER_GRAPHQL_URL }).health() : null,
    ]);
    return c.json({
      jobHealth,
      operator: operatorHealthFields(jobHealth),
      alertSink: await dispatchOperatorAlerts({ env, jobHealth, indexer, source: "operator_health" }),
      indexer,
    });
  });

  app.get("/operator/jobs", async (c) => {
    const jobs = await listFxBentoJobs();
    return c.json({
      jobHealth: await getFxBentoWorkerHealthSnapshot({ stuckAfterMs: workerStuckAfterMs(env) }),
      jobs,
    });
  });

  app.get("/operator/dashboard", async (c) => {
    const [jobHealth, jobs, settlementResults, indexer] = await Promise.all([
      getFxBentoWorkerHealthSnapshot({ stuckAfterMs: workerStuckAfterMs(env) }),
      listFxBentoJobs(),
      listFxBentoSettlementResults(),
      env.PONDER_GRAPHQL_URL ? createPonderReadSource({ graphqlUrl: env.PONDER_GRAPHQL_URL }).health() : null,
    ]);
    return c.json({
      service: "fx-bento-worker",
      persistence: databaseUrl ? "postgres" : "sqlite",
      jobHealth,
      operator: operatorHealthFields(jobHealth),
      alertSink: await dispatchOperatorAlerts({ env, jobHealth, indexer, source: "operator_dashboard" }),
      jobs,
      settlementResults,
      indexer,
    });
  });

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}

function requireWorkerAuth(env: ReturnType<typeof readEnv>) {
  return async (c: Context, next: Next) => {
    if (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test") {
      await next();
      return;
    }
    if (!env.API_SECRET_KEY) {
      return c.json({ error: "worker_auth_not_configured" }, 503);
    }
    const apiKey = c.req.header("X-API-Key") ?? bearerToken(c.req.header("Authorization"));
    if (apiKey !== env.API_SECRET_KEY) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

function bearerToken(value: string | undefined): string | undefined {
  if (!value?.startsWith("Bearer ")) return undefined;
  return value.slice("Bearer ".length);
}

function workerStuckAfterMs(env: ReturnType<typeof readEnv>): number {
  return env.WORKER_STUCK_JOB_SECONDS * 1000;
}

function operatorHealthFields(jobHealth: Awaited<ReturnType<typeof getFxBentoWorkerHealthSnapshot>>) {
  return {
    alerts: jobHealth.alerts,
    pendingConfirmations: jobHealth.pendingConfirmations,
    pendingReceiptCount: jobHealth.pendingReceiptCount,
    pendingPonderCount: jobHealth.pendingPonderCount,
    oldestPendingConfirmationAgeSeconds: jobHealth.oldestPendingConfirmationAgeSeconds,
    maxPonderLagSeconds: jobHealth.maxPonderLagSeconds,
    stuckJobs: jobHealth.stuckJobs,
    stuckFinalizations: jobHealth.stuckFinalizations,
  };
}
