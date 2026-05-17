import { missingRuntimeEnv, readEnvSafe } from "@bufinance/fx-bento-env";
import { createPonderReadSource, indexerHealth } from "@bufinance/fx-bento-ponder";
import { listReceipts } from "@bufinance/fx-bento-x402";
import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  const env = readEnvSafe();
  const missing = env.success ? missingRuntimeEnv(env.data) : [];
  const ponder = env.success
    ? await createPonderReadSource({ graphqlUrl: env.data.PONDER_GRAPHQL_URL, sqlUrl: env.data.PONDER_SQL_URL }).health()
    : indexerHealth();
  const receipts = env.success ? await listReceipts() : [];
  return c.json({
    ok: env.success,
    service: "@bufinance/fx-bento-api",
    timestamp: new Date().toISOString(),
    env: env.success ? env.data.ENVIRONMENT : "invalid",
    status: env.success ? (missing.length > 0 ? "degraded" : "ok") : "invalid_env",
    missingRuntimeEnv: missing,
    indexer: ponder,
    dependencies: {
      api: "ok",
      ponder,
      contractRpc: env.success && (env.data.FX_BENTO_RPC_URL || env.data.CONTRACT_RPC_URL || env.data.PONDER_RPC_URL) ? "configured" : "missing",
      liveblocks: env.success && env.data.LIVEBLOCKS_SECRET_KEY ? "configured" : "missing",
      x402: env.success && env.data.X402_RECEIVER_ADDRESS ? "configured" : "missing",
      worker: "not_checked",
    },
    persistence: env.success
      ? {
          mode:
            env.data.FX_BENTO_DATABASE_URL ||
            env.data.DATABASE_PRIVATE_URL ||
            env.data.DATABASE_URL ||
            env.data.POSTGRES_URL ||
            env.data.PRISMA_DATABASE_URL
              ? "postgres"
              : "sqlite",
          x402ReceiptCount: receipts.length,
        }
      : null,
    error: env.success ? null : env.error.flatten().fieldErrors,
  });
});
