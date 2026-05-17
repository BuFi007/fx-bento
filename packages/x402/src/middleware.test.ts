import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

import {
  buildPaymentRequirements,
  clearReceipts,
  configureX402ReceiptStore,
  encodePaymentEnvelope,
  listReceipts,
  requireX402Payment,
} from ".";

const payTo = "0x0000000000000000000000000000000000000001";

describe("x402 middleware", () => {
  test("returns 402 when payment is missing", async () => {
    const app = new Hono();
    app.get("/paid", requireX402Payment({ toolName: "quote", amount: "1000", payTo, network: "eip155:84532" }), (c) =>
      c.json({ ok: true })
    );
    const res = await app.request("/paid");
    expect(res.status).toBe(402);
    expect(res.headers.get("Payment-Required")).toBeTruthy();
  });

  test("accepts matching dev payment payload", async () => {
    configureX402ReceiptStore({ filePath: null });
    await clearReceipts();
    const app = new Hono();
    app.get("/paid", requireX402Payment({ toolName: "quote", amount: "1000", payTo, network: "eip155:84532" }), (c) =>
      c.json({ ok: true, receipt: (c as any).get("x402Receipt") })
    );
    const accepted = buildPaymentRequirements({
      amount: "1000",
      payTo,
      network: "eip155:84532",
      description: "FX Bento paid action: quote",
    });
    const res = await app.request("/paid", {
      headers: {
        "Payment-Signature": encodePaymentEnvelope({
          x402Version: 1,
          accepted,
          payload: { payer: "0xabc", settlementRef: "dev-tx" },
        }),
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      receipt: { toolName: "quote", requestMethod: "GET", requestPath: "/paid" },
    });
    expect(await listReceipts()).toEqual([
      expect.objectContaining({ toolName: "quote", requestPath: "/paid", settlementRef: "dev-tx" }),
    ]);
  });

  test("persists receipts to a durable sqlite store", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "fx-bento-x402-")), "receipts.sqlite");
    configureX402ReceiptStore({ dbPath });
    await clearReceipts();
    await listReceipts();

    const app = new Hono();
    app.post("/agent/run", requireX402Payment({ toolName: "agent", amount: "1000", payTo, network: "eip155:84532" }), (c) =>
      c.json({ ok: true })
    );
    const accepted = buildPaymentRequirements({
      amount: "1000",
      payTo,
      network: "eip155:84532",
      description: "FX Bento paid action: agent",
    });
    const res = await app.request("/agent/run", {
      method: "POST",
      headers: {
        "Payment-Signature": encodePaymentEnvelope({
          x402Version: 1,
          accepted,
          payload: { payer: "0xabc", settlementRef: "dev-tx-2" },
          receiptId: "rcpt_test",
        }),
      },
    });
    expect(res.status).toBe(200);

    configureX402ReceiptStore({ dbPath });
    expect(await listReceipts()).toEqual([
      expect.objectContaining({
        id: "rcpt_test",
        toolName: "agent",
        requestMethod: "POST",
        requestPath: "/agent/run",
      }),
    ]);
  });
});
