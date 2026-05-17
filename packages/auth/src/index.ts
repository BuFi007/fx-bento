import {
  AddressSchema,
  SignedActionSchema,
  WalletSessionSchema,
  assertFutureDeadline,
  normalizeAddress,
  type Address,
  type SignedAction,
  type WalletSession,
} from "@bufinance/fx-bento-shared-types";
import { verifyMessage } from "viem";
import { z } from "zod";

export const WalletAuthHeadersSchema = z.object({
  wallet: AddressSchema.optional(),
  sessionId: z.string().min(8).max(128).optional(),
  displayName: z.string().min(1).max(80).optional(),
});

export type WalletAuthHeaders = z.infer<typeof WalletAuthHeadersSchema>;

export interface NonceStore {
  consume(wallet: Address, nonce: string): boolean;
}

export class MemoryNonceStore implements NonceStore {
  private readonly seen = new Set<string>();

  consume(wallet: Address, nonce: string): boolean {
    const key = `${normalizeAddress(wallet)}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

export const globalNonceStore = new MemoryNonceStore();

export function sessionFromHeaders(headers: Headers): WalletSession | null {
  const parsed = WalletAuthHeadersSchema.safeParse({
    wallet: headers.get("x-wallet-address") ?? undefined,
    sessionId: headers.get("x-session-id") ?? undefined,
    displayName: headers.get("x-user-name") ?? undefined,
  });
  if (!parsed.success || !parsed.data.wallet) return null;
  return WalletSessionSchema.parse({
    wallet: parsed.data.wallet,
    sessionId: parsed.data.sessionId,
    displayName: parsed.data.displayName,
  });
}

export function buildWalletMessage(args: {
  action: string;
  payloadHash: string;
  nonce: string;
  deadline: number;
}): string {
  return [
    "FX Bento action",
    `action=${args.action}`,
    `payloadHash=${args.payloadHash}`,
    `nonce=${args.nonce}`,
    `deadline=${args.deadline}`,
  ].join("\n");
}

export async function verifySignedAction(args: {
  action: string;
  payloadHash: string;
  signed: SignedAction;
  nonceStore?: NonceStore;
  now?: number;
}): Promise<{ wallet: Address }> {
  const signed = SignedActionSchema.parse(args.signed);
  assertFutureDeadline(signed.deadline, args.now);
  const store = args.nonceStore ?? globalNonceStore;
  if (!store.consume(signed.wallet, signed.nonce)) {
    throw new Error("nonce_reused");
  }

  const valid = await verifyMessage({
    address: signed.wallet,
    message: buildWalletMessage({
      action: args.action,
      payloadHash: args.payloadHash,
      nonce: signed.nonce,
      deadline: signed.deadline,
    }),
    signature: signed.signature,
  });

  if (!valid) throw new Error("bad_signature");
  return { wallet: normalizeAddress(signed.wallet) };
}
