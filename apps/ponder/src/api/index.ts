import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "fx-bento-ponder",
    chainId: Number(process.env.PONDER_CHAIN_ID ?? process.env.FX_BENTO_CHAIN_ID ?? 0),
    schema: process.env.DATABASE_SCHEMA ?? null,
  })
);

export default app;
