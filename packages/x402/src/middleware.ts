import type { Context, MiddlewareHandler } from "hono";

import { getReceipt, saveReceipt } from "./receipts";
import {
  buildPaymentRequirements,
  createDevPaymentVerifier,
  decodePaymentHeader,
  encodePaymentEnvelope,
} from "./verify";
import type { PaymentRequirements, PaymentVerifier, X402Receipt } from "./types";

export interface X402MiddlewareOptions {
  toolName: string;
  amount: string;
  payTo: `0x${string}`;
  network: string;
  verifier?: PaymentVerifier;
  description?: string;
}

export function paymentRequiredResponse(c: Context, requirements: PaymentRequirements) {
  const envelope = { x402Version: 1, accepts: [requirements] };
  return c.json(
    {
      error: "payment_required",
      x402Version: envelope.x402Version,
      accepts: envelope.accepts,
    },
    402,
    {
      "Payment-Required": encodePaymentEnvelope(envelope),
    }
  );
}

export function requireX402Payment(options: X402MiddlewareOptions): MiddlewareHandler {
  const verifier = options.verifier ?? createDevPaymentVerifier();
  const requirements = buildPaymentRequirements({
    amount: options.amount,
    payTo: options.payTo,
    network: options.network,
    description: options.description ?? `FX Bento paid action: ${options.toolName}`,
  });

  return async (c, next) => {
    const header = c.req.header("Payment-Signature") ?? c.req.header("X-Payment");
    if (!header) return paymentRequiredResponse(c, requirements);

    try {
      const payload = decodePaymentHeader(header);
      const result = await verifier.verify({ payload, requirements, request: c.req.raw });
      if (!result.ok) return c.json({ error: "payment_rejected", reason: result.reason }, 402);
      const receipt = await saveReceipt({
        ...result.receipt,
        toolName: options.toolName,
        requestMethod: c.req.method,
        requestPath: c.req.path,
        metadata: {
          ...result.receipt.metadata,
          resource: c.req.path,
        },
      } satisfies X402Receipt);
      c.set("x402Receipt", receipt);
      await next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "invalid_payment_payload", message }, 402);
    }
  };
}

export async function receiptById(id: string) {
  return await getReceipt(id);
}
