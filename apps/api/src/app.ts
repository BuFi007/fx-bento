import { readEnv } from "@bufinance/fx-bento-env";
import { configureFxBentoSettlementResultStore } from "@bufinance/fx-bento-game";
import { configureX402ReceiptStore, requireX402Payment } from "@bufinance/fx-bento-x402";
import { createLogger } from "@bufinance/logger";
import { createCorsMiddleware, notFoundHandler, requestContext } from "@bufinance/worker-base";
import { Hono } from "hono";

import { apiErrorHandler } from "./lib/errors";
import { fxBentoRoutes } from "./routes/fx-bento";
import { fxTelaranaRoutes } from "./routes/fx-telarana";
import { healthRoutes } from "./routes/health";
import { liveblocksRoutes } from "./routes/liveblocks";
import { marketRoutes } from "./routes/markets";
import { mcpRoutes } from "./routes/mcp";
import { perpsRoutes } from "./routes/perps";
import { x402Routes } from "./routes/x402";

const log = createLogger({ prefix: "fx-bento:api" });

export function createApiApp() {
  const env = readEnv();
  const app = new Hono();
  const databaseUrl =
    env.FX_BENTO_DATABASE_URL ??
    env.DATABASE_PRIVATE_URL ??
    env.DATABASE_URL ??
    env.POSTGRES_URL ??
    env.PRISMA_DATABASE_URL;
  configureFxBentoSettlementResultStore({
    databaseUrl,
    dbPath:
      databaseUrl
        ? undefined
        : env.FX_BENTO_DB_PATH ??
          env.SETTLEMENT_RESULT_STORE_PATH ??
          `.fx-bento/fx-bento-${env.ENVIRONMENT}.sqlite`,
  });
  configureX402ReceiptStore({
    databaseUrl,
    dbPath: databaseUrl ? undefined : env.FX_BENTO_DB_PATH ?? `.fx-bento/fx-bento-${env.ENVIRONMENT}.sqlite`,
  });
  const payTo =
    (env.X402_RECEIVER_ADDRESS ??
      env.TREASURY_ADDRESS ??
      "0x0000000000000000000000000000000000000001") as `0x${string}`;

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
        allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Request-Id", "Payment-Signature", "X-Payment"],
        exposeHeaders: ["X-Request-Id", "X-Response-Time", "Payment-Required"],
      },
    })
  );

  app.use(
    "/perps/quote",
    requireX402Payment({
      toolName: "quote_perp_trade",
      amount: "1000",
      payTo,
      network: env.X402_NETWORK,
    })
  );
  app.use(
    "/mcp/workflows/*/run",
    requireX402Payment({
      toolName: "agent_workflow_execution",
      amount: "1000",
      payTo,
      network: env.X402_NETWORK,
    })
  );

  app.route("/", healthRoutes);
  app.route("/", liveblocksRoutes);
  app.route("/", marketRoutes);
  app.route("/", perpsRoutes);
  app.route("/", fxBentoRoutes);
  app.route("/", fxTelaranaRoutes);
  app.route("/", mcpRoutes);
  app.route("/", x402Routes);

  app.onError(apiErrorHandler);
  app.notFound(notFoundHandler);

  log.info({ routes: "mounted" }, "FX Bento API initialized");
  return app;
}
