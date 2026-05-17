import { CandleQuerySchema, getCandles, getMarket, getMarketPrice, listMarkets } from "@bufinance/fx-bento-market-data";
import { Hono } from "hono";

import { parseQuery } from "../lib/validation";

export const marketRoutes = new Hono();

marketRoutes.get("/markets", (c) => c.json({ markets: listMarkets() }));

marketRoutes.get("/markets/:marketId", (c) => {
  const market = getMarket(c.req.param("marketId"));
  return market ? c.json({ market }) : c.json({ error: "market_not_found" }, 404);
});

marketRoutes.get("/markets/:marketId/price", (c) => c.json(getMarketPrice(c.req.param("marketId"))));

marketRoutes.get("/markets/:marketId/candles", (c) => {
  const query = parseQuery(c, CandleQuerySchema);
  return c.json({ candles: getCandles(c.req.param("marketId"), query) });
});
