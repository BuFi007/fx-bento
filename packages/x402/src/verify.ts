import { nowIso } from "@bufinance/fx-bento-shared-types";

import { saveReceipt } from "./receipts";
import {
  PaymentPayloadSchema,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentVerifier,
} from "./types";

export function encodePaymentEnvelope(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

export function decodePaymentHeader(header: string): PaymentPayload {
  return PaymentPayloadSchema.parse(JSON.parse(Buffer.from(header, "base64").toString("utf-8")));
}

export function paymentRequirementsMatch(
  actual: PaymentRequirements,
  expected: PaymentRequirements
): boolean {
  return (
    actual.scheme === expected.scheme &&
    actual.network === expected.network &&
    actual.asset.toLowerCase() === expected.asset.toLowerCase() &&
    actual.amount === expected.amount &&
    actual.payTo.toLowerCase() === expected.payTo.toLowerCase()
  );
}

export function createDevPaymentVerifier(): PaymentVerifier {
  return {
    async verify({ payload, requirements }) {
      if (!paymentRequirementsMatch(payload.accepted, requirements)) {
        return { ok: false, reason: "payment_requirements_mismatch" };
      }
      const receipt = await saveReceipt({
        id: payload.receiptId ?? `rcpt_${crypto.randomUUID().slice(0, 12)}`,
        payer: String(payload.payload.payer ?? "dev-payer"),
        amount: requirements.amount,
        network: requirements.network,
        settlementRef: String(payload.payload.settlementRef ?? "dev-settlement"),
        status: "verified",
        metadata: {
          verifier: "dev",
          acceptedDescription: requirements.description,
        },
        createdAt: nowIso(),
      });
      return { ok: true, receipt };
    },
  };
}

export function buildPaymentRequirements(args: {
  amount: string;
  payTo: `0x${string}`;
  network: string;
  asset?: string;
  description: string;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: args.network,
    asset: args.asset ?? "USDC",
    amount: args.amount,
    payTo: args.payTo,
    maxTimeoutSeconds: 120,
    description: args.description,
    extra: { version: "scaffold" },
  };
}
