import { AddressSchema } from "@bufinance/fx-bento-shared-types";
import z from "zod";

export const PaymentRequirementsSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string().min(1),
  asset: z.string().min(1),
  amount: z.string().regex(/^[0-9]+$/),
  payTo: AddressSchema,
  maxTimeoutSeconds: z.number().int().positive(),
  description: z.string().min(1),
  extra: z.record(z.unknown()).default({}),
});

export const PaymentPayloadSchema = z.object({
  x402Version: z.number().int().positive(),
  accepted: PaymentRequirementsSchema,
  payload: z.record(z.unknown()).default({}),
  receiptId: z.string().optional(),
});

export const X402ReceiptSchema = z.object({
  id: z.string(),
  payer: z.string(),
  amount: z.string(),
  network: z.string(),
  settlementRef: z.string(),
  toolName: z.string().optional(),
  requestMethod: z.string().optional(),
  requestPath: z.string().optional(),
  status: z.enum(["verified", "rejected"]).default("verified"),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;
export type X402Receipt = z.infer<typeof X402ReceiptSchema>;

export interface PaymentVerifier {
  verify(args: {
    payload: PaymentPayload;
    requirements: PaymentRequirements;
    request: Request;
  }): Promise<{ ok: true; receipt: X402Receipt } | { ok: false; reason: string }>;
}
