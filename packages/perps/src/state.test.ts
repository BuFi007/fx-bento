import { beforeEach, describe, expect, test } from "bun:test";

import {
  createPerpIntent,
  liquidationCandidates,
  resetPerpsStateForTests,
  upsertPerpPosition,
} from ".";

const wallet = "0x00000000000000000000000000000000000000a1";

describe("perps state", () => {
  beforeEach(() => resetPerpsStateForTests());

  test("creates a pending intent when signature is absent", () => {
    const intent = createPerpIntent({
      wallet,
      marketId: "USDC/EURC",
      side: "long",
      notionalUsd: 100,
      leverage: 5,
      marginUsd: 20,
      nonce: "nonce-123456",
      deadline: Date.now() + 60_000,
    });
    expect(intent.status).toBe("pending_signature");
    expect(intent.quote.feeUsd).toBe(0.05);
  });

  test("rejects stale intents", () => {
    expect(() =>
      createPerpIntent({
        wallet,
        marketId: "USDC/EURC",
        side: "long",
        notionalUsd: 100,
        leverage: 5,
        marginUsd: 20,
        nonce: "nonce-123456",
        deadline: Date.now() - 1,
      })
    ).toThrow("deadline_expired");
  });

  test("derives liquidation candidates from indexed positions", () => {
    upsertPerpPosition({
      id: "pos_1",
      wallet,
      marketId: "USDC/EURC",
      side: "long",
      notionalUsd: 100,
      marginUsd: 10,
      entryPrice: 0.92,
      healthFactor: 1.01,
      status: "open",
      updatedAt: new Date().toISOString(),
    });
    expect(liquidationCandidates()).toHaveLength(1);
  });
});
