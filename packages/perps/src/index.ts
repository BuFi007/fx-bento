import { getMarketPrice, listMarkets } from "@bufinance/fx-bento-market-data";
import {
  AddressSchema,
  MarketIdSchema,
  HexSchema,
  assertFutureDeadline,
  normalizeAddress,
  type Address,
} from "@bufinance/fx-bento-shared-types";
import { verifyTypedData, type Hex } from "viem";
import z from "zod";

export const PerpQuoteInputSchema = z.object({
  marketId: MarketIdSchema,
  side: z.enum(["long", "short"]),
  notionalUsd: z.coerce.number().positive().max(1_000_000),
  leverage: z.coerce.number().positive().max(25).default(1),
  wallet: AddressSchema.optional(),
});

export const PerpIntentSchema = PerpQuoteInputSchema.extend({
  wallet: AddressSchema,
  marginUsd: z.coerce.number().positive(),
  nonce: z.string().min(8).max(128),
  deadline: z.coerce.number().int().positive(),
  signature: HexSchema.optional(),
});

export type PerpQuoteInput = z.infer<typeof PerpQuoteInputSchema>;
export type PerpIntent = z.infer<typeof PerpIntentSchema>;

export interface PerpIntentRecord extends PerpIntent {
  id: string;
  status: "pending_signature" | "ready_for_submission" | "submitted" | "cancelled";
  quote: ReturnType<typeof quotePerpTrade>;
  createdAt: string;
  updatedAt: string;
}

export interface PerpPosition {
  id: string;
  wallet: Address;
  marketId: string;
  side: "long" | "short";
  notionalUsd: number;
  marginUsd: number;
  entryPrice: number;
  healthFactor: number;
  status: "open" | "closed" | "liquidatable";
  updatedAt: string;
}

export interface PerpTrade {
  id: string;
  wallet: Address;
  marketId: string;
  side: "long" | "short";
  notionalUsd: number;
  price: number;
  txHash?: string;
  createdAt: string;
}

export const PERP_MARKETS = listMarkets().map((market) => ({
  ...market,
  maxLeverage: market.id === "USDC/EURC" ? 20 : 12,
  minMarginUsd: 10,
}));

export function listPerpMarkets() {
  return PERP_MARKETS;
}

export function quotePerpTrade(input: PerpQuoteInput) {
  const parsed = PerpQuoteInputSchema.parse(input);
  const market = PERP_MARKETS.find((item) => item.id === parsed.marketId);
  if (!market) throw new Error(`Unsupported perps market ${parsed.marketId}`);
  if (parsed.leverage > market.maxLeverage) throw new Error("leverage_too_high");

  const snapshot = getMarketPrice(parsed.marketId);
  const marginUsd = Number((parsed.notionalUsd / parsed.leverage).toFixed(2));
  const feeUsd = Number((parsed.notionalUsd * 0.0005).toFixed(2));
  const liquidationBuffer = 1 / parsed.leverage;
  const liquidationPrice =
    parsed.side === "long"
      ? snapshot.price * (1 - liquidationBuffer)
      : snapshot.price * (1 + liquidationBuffer);

  return {
    marketId: parsed.marketId,
    side: parsed.side,
    oraclePrice: snapshot.price,
    notionalUsd: parsed.notionalUsd,
    leverage: parsed.leverage,
    marginUsd,
    feeUsd,
    estimatedLiquidationPrice: Number(liquidationPrice.toFixed(6)),
    requiresSignature: true,
    source: snapshot.source,
    observedAt: snapshot.observedAt,
  };
}

const intents = new Map<string, PerpIntentRecord>();
const positions = new Map<string, PerpPosition>();
const trades = new Map<string, PerpTrade>();

export function createPerpIntent(input: unknown, now = Date.now()): PerpIntentRecord {
  const parsed = PerpIntentSchema.parse(input);
  assertFutureDeadline(parsed.deadline, now);
  const quote = quotePerpTrade(parsed);
  if (Math.abs(parsed.marginUsd - quote.marginUsd) > 0.01) throw new Error("margin_quote_mismatch");
  const timestamp = new Date(now).toISOString();
  const record: PerpIntentRecord = {
    ...parsed,
    wallet: normalizeAddress(parsed.wallet),
    id: `intent_${crypto.randomUUID().slice(0, 12)}`,
    status: parsed.signature ? "ready_for_submission" : "pending_signature",
    quote,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  intents.set(record.id, record);
  return record;
}

export function getPerpIntent(id: string): PerpIntentRecord | null {
  return intents.get(id) ?? null;
}

export function listPerpIntents(): PerpIntentRecord[] {
  return [...intents.values()];
}

export function listPerpPositions(address: string): PerpPosition[] {
  const wallet = AddressSchema.parse(address).toLowerCase();
  return [...positions.values()].filter((position) => position.wallet.toLowerCase() === wallet);
}

export function listPerpTrades(address: string): PerpTrade[] {
  const wallet = AddressSchema.parse(address).toLowerCase();
  return [...trades.values()].filter((trade) => trade.wallet.toLowerCase() === wallet);
}

export function upsertPerpPosition(position: PerpPosition): PerpPosition {
  const parsed = {
    ...position,
    wallet: normalizeAddress(AddressSchema.parse(position.wallet)),
    updatedAt: position.updatedAt || new Date().toISOString(),
  };
  positions.set(parsed.id, parsed);
  return parsed;
}

export function recordPerpTrade(trade: PerpTrade): PerpTrade {
  const parsed = {
    ...trade,
    wallet: normalizeAddress(AddressSchema.parse(trade.wallet)),
    createdAt: trade.createdAt || new Date().toISOString(),
  };
  trades.set(parsed.id, parsed);
  return parsed;
}

export const PERP_INTENT_DOMAIN = {
  name: "FX Bento Perps",
  version: "1",
} as const;

export const PERP_INTENT_TYPES = {
  PerpIntent: [
    { name: "wallet", type: "address" },
    { name: "marketId", type: "string" },
    { name: "side", type: "string" },
    { name: "notionalUsd", type: "uint256" },
    { name: "marginUsd", type: "uint256" },
    { name: "leverageBps", type: "uint256" },
    { name: "nonce", type: "string" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function buildPerpIntentTypedData(intent: PerpIntent, chainId: number, verifyingContract: Address) {
  const parsed = PerpIntentSchema.parse(intent);
  return {
    domain: { ...PERP_INTENT_DOMAIN, chainId, verifyingContract },
    types: PERP_INTENT_TYPES,
    primaryType: "PerpIntent",
    message: {
      wallet: parsed.wallet,
      marketId: parsed.marketId,
      side: parsed.side,
      notionalUsd: BigInt(Math.round(parsed.notionalUsd * 1_000_000)),
      marginUsd: BigInt(Math.round(parsed.marginUsd * 1_000_000)),
      leverageBps: BigInt(Math.round(parsed.leverage * 10_000)),
      nonce: parsed.nonce,
      deadline: BigInt(parsed.deadline),
    },
  } as const;
}

export async function verifyPerpIntentSignature(args: {
  intent: PerpIntent;
  chainId: number;
  verifyingContract: Address;
  signature: Hex;
}) {
  const typed = buildPerpIntentTypedData(args.intent, args.chainId, args.verifyingContract);
  return verifyTypedData({
    address: args.intent.wallet,
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
    signature: args.signature,
  });
}

export function liquidationCandidates() {
  return [...positions.values()]
    .filter((position) => position.status === "liquidatable" || position.healthFactor <= 1.05)
    .map((position) => ({
      id: position.id,
      marketId: position.marketId,
      wallet: position.wallet,
      healthFactor: position.healthFactor,
      reason: position.status === "liquidatable" ? "position_marked_liquidatable" : "health_factor_below_threshold",
    }));
}

export function fundingSnapshot() {
  return PERP_MARKETS.map((market) => ({
    marketId: market.id,
    fundingRateHourlyBps: market.id === "USDC/EURC" ? 0.2 : 0.35,
    updatedAt: new Date().toISOString(),
  }));
}

export function resetPerpsStateForTests(): void {
  intents.clear();
  positions.clear();
  trades.clear();
}
