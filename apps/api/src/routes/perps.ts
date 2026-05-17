import {
  PerpQuoteInputSchema,
  createPerpIntent,
  fundingSnapshot,
  getPerpIntent,
  liquidationCandidates,
  listPerpPositions,
  listPerpTrades,
  listPerpMarkets,
  quotePerpTrade,
} from "@bufinance/fx-bento-perps";
import { Hono } from "hono";

import { parseJson } from "../lib/validation";

export const perpsRoutes = new Hono();

perpsRoutes.get("/perps/markets", (c) => c.json({ markets: listPerpMarkets() }));

perpsRoutes.post("/perps/quote", async (c) => {
  const body = await parseJson(c, PerpQuoteInputSchema);
  return c.json({ quote: quotePerpTrade(body) });
});

perpsRoutes.post("/perps/intents", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(createPerpIntent(body), 201);
});

perpsRoutes.get("/perps/intents/:id", (c) => {
  const intent = getPerpIntent(c.req.param("id"));
  return intent ? c.json(intent) : c.json({ error: "intent_not_found" }, 404);
});

perpsRoutes.get("/perps/positions/:address", (c) =>
  c.json({ address: c.req.param("address"), positions: listPerpPositions(c.req.param("address")), source: "indexed-state" })
);

perpsRoutes.get("/perps/trades/:address", (c) =>
  c.json({ address: c.req.param("address"), trades: listPerpTrades(c.req.param("address")), source: "indexed-state" })
);

perpsRoutes.get("/perps/funding", (c) => c.json({ funding: fundingSnapshot() }));

perpsRoutes.get("/perps/liquidations/candidates", (c) =>
  c.json({ candidates: liquidationCandidates() })
);
