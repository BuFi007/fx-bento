import { serve } from "@hono/node-server";

import { readEnv } from "@bufinance/fx-bento-env";
import { createLogger } from "@bufinance/logger";

import { createApiApp } from "./app";

const env = readEnv();
const log = createLogger({ prefix: "fx-bento:server" });
const app = createApiApp();

if (import.meta.main) {
  serve({ fetch: app.fetch, port: env.PORT });
  log.info({ port: env.PORT }, `FX Bento API listening on http://localhost:${env.PORT}`);
}

export { app };
