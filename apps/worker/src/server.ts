import { serve } from "@hono/node-server";

import { createWorkerApp } from "./app";

const port = Number(process.env.WORKER_PORT ?? 8788);

serve({
  fetch: createWorkerApp().fetch,
  port,
});

console.log(`FX Bento worker listening on http://localhost:${port}`);
