import { getMarketPrice, listMarkets } from "@bufinance/fx-bento-market-data";
import { AddressSchema, MarketIdSchema, assertFutureDeadline, normalizeAddress } from "@bufinance/fx-bento-shared-types";
import { z } from "zod";

export const BorrowQuoteInputSchema = z.object({
  marketId: MarketIdSchema,
  wallet: AddressSchema.optional(),
  collateralAmount: z.coerce.number().positive(),
  collateralSymbol: z.string().min(2).default("USDC"),
  borrowSymbol: z.string().min(2).default("EURC"),
});

export const BorrowIntentSchema = BorrowQuoteInputSchema.extend({
  wallet: AddressSchema,
  nonce: z.string().min(8).max(128),
  deadline: z.coerce.number().int().positive(),
});

export type BorrowQuoteInput = z.infer<typeof BorrowQuoteInputSchema>;
export type BorrowIntent = z.infer<typeof BorrowIntentSchema>;

export interface BorrowIntentRecord extends BorrowIntent {
  id: string;
  quote: ReturnType<typeof quoteBorrow>;
  status: "pending_signature" | "ready_for_submission" | "submitted" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface FxTelaranaPosition {
  id: string;
  wallet: `0x${string}`;
  marketId: string;
  collateralSymbol: string;
  borrowSymbol: string;
  collateralAmount: number;
  debtAmount: number;
  healthFactor: number;
  status: "open" | "closed" | "liquidatable";
  updatedAt: string;
}

export function listFxTelaranaMarkets() {
  return listMarkets().map((market) => ({
    ...market,
    lendingEnabled: true,
    borrowEnabled: true,
    routeKind: "stablecoin-fx",
  }));
}

export function quoteBorrow(input: BorrowQuoteInput) {
  const parsed = BorrowQuoteInputSchema.parse(input);
  const snapshot = getMarketPrice(parsed.marketId);
  const ltv = parsed.marketId === "USDC/EURC" ? 0.82 : 0.72;
  const maxBorrow = Number((parsed.collateralAmount * snapshot.price * ltv).toFixed(6));
  return {
    marketId: parsed.marketId,
    collateralSymbol: parsed.collateralSymbol,
    borrowSymbol: parsed.borrowSymbol,
    collateralAmount: parsed.collateralAmount,
    maxBorrow,
    ltv,
    oraclePrice: snapshot.price,
    oracleFresh: true,
    requiresSignature: true,
    source: snapshot.source,
    observedAt: snapshot.observedAt,
  };
}

const borrowIntents = new Map<string, BorrowIntentRecord>();
const positions = new Map<string, FxTelaranaPosition>();

export function createBorrowIntent(input: unknown, now = Date.now()): BorrowIntentRecord {
  const parsed = BorrowIntentSchema.parse(input);
  assertFutureDeadline(parsed.deadline, now);
  const quote = quoteBorrow(parsed);
  const timestamp = new Date(now).toISOString();
  const record: BorrowIntentRecord = {
    ...parsed,
    wallet: normalizeAddress(parsed.wallet),
    id: `borrow_${crypto.randomUUID().slice(0, 12)}`,
    quote,
    status: "pending_signature",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  borrowIntents.set(record.id, record);
  return record;
}

export function getBorrowIntent(id: string): BorrowIntentRecord | null {
  return borrowIntents.get(id) ?? null;
}

export function inspectLoanPosition(address: string) {
  const wallet = AddressSchema.parse(address).toLowerCase();
  return {
    address,
    positions: [...positions.values()].filter((position) => position.wallet.toLowerCase() === wallet),
    source: "indexed-state",
  };
}

export function upsertFxTelaranaPosition(position: FxTelaranaPosition): FxTelaranaPosition {
  const parsed = {
    ...position,
    wallet: normalizeAddress(AddressSchema.parse(position.wallet)),
    updatedAt: position.updatedAt || new Date().toISOString(),
  };
  positions.set(parsed.id, parsed);
  return parsed;
}

export function resetFxTelaranaStateForTests(): void {
  borrowIntents.clear();
  positions.clear();
}
