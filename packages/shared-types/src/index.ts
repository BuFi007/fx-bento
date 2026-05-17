import { z } from "zod";

export const HexSchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value),
  "Expected 0x-prefixed hex"
);

export const AddressSchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value),
  "Expected EVM address"
);

export const MarketIdSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9-]+\/[A-Z0-9-]+$/);

export const StablecoinSymbolSchema = z.enum(["USDC", "EURC", "MXNB", "BRL", "JPYC", "QCAD"]);

export const ProductSurfaceSchema = z.enum(["fx-bento", "perps", "fx-telarana", "mcp"]);

export const ISODateStringSchema = z.string().datetime();

export const WalletSessionSchema = z.object({
  wallet: AddressSchema,
  sessionId: z.string().min(8).max(128).optional(),
  chainId: z.coerce.number().int().positive().optional(),
  displayName: z.string().min(1).max(80).optional(),
});

export const SignedActionSchema = z.object({
  wallet: AddressSchema,
  nonce: z.string().min(8).max(128),
  deadline: z.coerce.number().int().positive(),
  signature: HexSchema,
});

export const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export type Address = z.infer<typeof AddressSchema>;
export type Hex = z.infer<typeof HexSchema>;
export type MarketId = z.infer<typeof MarketIdSchema>;
export type ProductSurface = z.infer<typeof ProductSurfaceSchema>;
export type WalletSession = z.infer<typeof WalletSessionSchema>;
export type SignedAction = z.infer<typeof SignedActionSchema>;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export function normalizeAddress(address: Address): Address {
  return address.toLowerCase() as Address;
}

export function assertFutureDeadline(deadline: number, now = Date.now()): void {
  if (deadline <= now) {
    throw new Error("deadline_expired");
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
