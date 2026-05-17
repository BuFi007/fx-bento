import {
  BorrowQuoteInputSchema,
  createBorrowIntent,
  inspectLoanPosition,
  listFxTelaranaMarkets,
  quoteBorrow,
} from "@bufinance/fx-bento-fx-telarana";
import { Hono } from "hono";

import { parseJson } from "../lib/validation";

export const fxTelaranaRoutes = new Hono();

fxTelaranaRoutes.get("/fx-telarana/markets", (c) => c.json({ markets: listFxTelaranaMarkets() }));

fxTelaranaRoutes.post("/fx-telarana/borrow/quote", async (c) => {
  const body = await parseJson(c, BorrowQuoteInputSchema);
  return c.json({ quote: quoteBorrow(body) });
});

fxTelaranaRoutes.post("/fx-telarana/borrow/intents", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(createBorrowIntent(body), 201);
});

fxTelaranaRoutes.get("/fx-telarana/positions/:address", (c) =>
  c.json(inspectLoanPosition(c.req.param("address")))
);
