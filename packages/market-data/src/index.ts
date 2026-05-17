import { MarketIdSchema, type MarketId } from "@bufinance/fx-bento-shared-types";
import { z } from "zod";

export const MarketSchema = z.object({
  id: MarketIdSchema,
  base: z.string().min(2),
  quote: z.string().min(2),
  displayName: z.string(),
  kind: z.enum(["stable-fx", "crypto-fx"]),
  decimals: z.number().int().positive(),
  oracleMaxStaleSeconds: z.number().int().positive(),
});

export const CandleQuerySchema = z.object({
  interval: z.enum(["1m", "5m", "15m", "1h", "1d"]).default("1m"),
  limit: z.coerce.number().int().positive().max(500).default(120),
});

export type Market = z.infer<typeof MarketSchema>;
export type CandleQuery = z.infer<typeof CandleQuerySchema>;

export const FX_MARKETS: Market[] = [
  {
    id: "USDC/EURC",
    base: "USDC",
    quote: "EURC",
    displayName: "USDC / EURC",
    kind: "stable-fx",
    decimals: 6,
    oracleMaxStaleSeconds: 30,
  },
  {
    id: "USDC/MXNB",
    base: "USDC",
    quote: "MXNB",
    displayName: "USDC / MXNB",
    kind: "stable-fx",
    decimals: 6,
    oracleMaxStaleSeconds: 30,
  },
  {
    id: "USDC/BRL",
    base: "USDC",
    quote: "BRL",
    displayName: "USDC / BRL",
    kind: "stable-fx",
    decimals: 6,
    oracleMaxStaleSeconds: 45,
  },
  {
    id: "USDC/JPYC",
    base: "USDC",
    quote: "JPYC",
    displayName: "USDC / JPYC",
    kind: "stable-fx",
    decimals: 6,
    oracleMaxStaleSeconds: 45,
  },
  {
    id: "USDC/QCAD",
    base: "USDC",
    quote: "QCAD",
    displayName: "USDC / QCAD",
    kind: "stable-fx",
    decimals: 6,
    oracleMaxStaleSeconds: 45,
  },
];

const PRICE_FIXTURES: Record<MarketId, number> = {
  "USDC/EURC": 0.9231,
  "USDC/MXNB": 16.72,
  "USDC/BRL": 5.14,
  "USDC/JPYC": 155.2,
  "USDC/QCAD": 1.37,
};

export function listMarkets(): Market[] {
  return FX_MARKETS;
}

export function getMarket(marketId: string): Market | null {
  const parsed = MarketIdSchema.safeParse(marketId);
  if (!parsed.success) return null;
  return FX_MARKETS.find((market) => market.id === parsed.data) ?? null;
}

export function requireMarket(marketId: string): Market {
  const market = getMarket(marketId);
  if (!market) throw new Error(`Unsupported market ${marketId}`);
  return market;
}

export function getMarketPrice(marketId: string, now = Date.now()) {
  const market = requireMarket(marketId);
  const fixture = PRICE_FIXTURES[market.id];
  return {
    marketId: market.id,
    price: fixture,
    source: "fixture-oracle",
    observedAt: new Date(now).toISOString(),
    maxStaleSeconds: market.oracleMaxStaleSeconds,
  };
}

export function getCandles(marketId: string, query: CandleQuery, now = Date.now()) {
  const market = requireMarket(marketId);
  const basePrice = PRICE_FIXTURES[market.id];
  const intervalMs = intervalToMs(query.interval);
  return Array.from({ length: query.limit }, (_, index) => {
    const t = now - (query.limit - index) * intervalMs;
    const drift = Math.sin(index / 7) * basePrice * 0.001;
    const close = Number((basePrice + drift).toFixed(6));
    return {
      marketId: market.id,
      t: new Date(t).toISOString(),
      open: Number((close * 0.9998).toFixed(6)),
      high: Number((close * 1.0009).toFixed(6)),
      low: Number((close * 0.9991).toFixed(6)),
      close,
    };
  });
}

function intervalToMs(interval: CandleQuery["interval"]): number {
  switch (interval) {
    case "1m":
      return 60_000;
    case "5m":
      return 300_000;
    case "15m":
      return 900_000;
    case "1h":
      return 3_600_000;
    case "1d":
      return 86_400_000;
  }
}
