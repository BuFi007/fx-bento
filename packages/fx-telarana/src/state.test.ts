import { beforeEach, describe, expect, test } from "bun:test";

import {
  createBorrowIntent,
  inspectLoanPosition,
  resetFxTelaranaStateForTests,
  upsertFxTelaranaPosition,
} from ".";

const wallet = "0x00000000000000000000000000000000000000a1";

describe("FX Telarana state", () => {
  beforeEach(() => resetFxTelaranaStateForTests());

  test("creates a borrow intent with quote context", () => {
    const intent = createBorrowIntent({
      wallet,
      marketId: "USDC/EURC",
      collateralAmount: 100,
      collateralSymbol: "USDC",
      borrowSymbol: "EURC",
      nonce: "nonce-123456",
      deadline: Date.now() + 60_000,
    });
    expect(intent.quote.maxBorrow).toBeGreaterThan(0);
    expect(intent.status).toBe("pending_signature");
  });

  test("returns indexed loan positions by wallet", () => {
    upsertFxTelaranaPosition({
      id: "loan_1",
      wallet,
      marketId: "USDC/EURC",
      collateralSymbol: "USDC",
      borrowSymbol: "EURC",
      collateralAmount: 100,
      debtAmount: 50,
      healthFactor: 1.5,
      status: "open",
      updatedAt: new Date().toISOString(),
    });
    expect(inspectLoanPosition(wallet).positions).toHaveLength(1);
  });
});
