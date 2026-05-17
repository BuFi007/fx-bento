import { listReceipts, receiptById } from "@bufinance/fx-bento-x402";
import { Hono } from "hono";

export const x402Routes = new Hono();

x402Routes.get("/x402/receipts", async (c) => c.json({ receipts: await listReceipts() }));

x402Routes.post("/x402/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.receiptId !== "string") return c.json({ error: "receiptId required" }, 400);
  const receipt = await receiptById(body.receiptId);
  return receipt ? c.json({ ok: true, receipt }) : c.json({ ok: false, error: "receipt_not_found" }, 404);
});
