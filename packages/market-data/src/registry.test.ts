import { describe, expect, test } from "bun:test";

import { getMarket, getMarketPrice, listMarkets } from ".";

describe("market registry", () => {
  test("contains the initial FX market set", () => {
    expect(listMarkets().map((market) => market.id)).toContain("USDC/EURC");
    expect(listMarkets().map((market) => market.id)).toContain("USDC/MXNB");
  });

  test("rejects unsupported market ids", () => {
    expect(getMarket("USDC/NOPE")).toBeNull();
  });

  test("returns deterministic price snapshots", () => {
    expect(getMarketPrice("USDC/EURC", 0)).toMatchObject({
      marketId: "USDC/EURC",
      source: "fixture-oracle",
    });
  });
});
