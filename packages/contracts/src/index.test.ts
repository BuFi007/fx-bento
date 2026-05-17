import { describe, expect, test } from "bun:test";

import {
  FX_BENTO_ABIS,
  FX_BENTO_EVENT_NAMES_BY_CONTRACT,
  FX_BENTO_ROOM_ESCROW_EVENTS,
  FX_BENTO_SETTLEMENT_EVENTS,
  type ContractName,
} from ".";

describe("FX Bento contract metadata", () => {
  test("exports event names that match ABI fragments", () => {
    for (const [contractName, eventNames] of Object.entries(FX_BENTO_EVENT_NAMES_BY_CONTRACT)) {
      const abi = FX_BENTO_ABIS[contractName as ContractName];
      const abiEventNames = new Set(abi.filter((item) => item.type === "event").map((item) => item.name));
      for (const eventName of eventNames) {
        expect(abiEventNames.has(eventName)).toBe(true);
      }
    }
  });

  test("uses current Solidity event names for refund, commitment, and settlement", () => {
    expect(FX_BENTO_ROOM_ESCROW_EVENTS).toContain("Refunded");
    expect(FX_BENTO_ROOM_ESCROW_EVENTS).not.toContain("RefundClaimed" as never);
    expect(FX_BENTO_SETTLEMENT_EVENTS).toContain("ResultsSubmitted");
    expect(FX_BENTO_SETTLEMENT_EVENTS).not.toContain("ResultsRootPosted" as never);
  });
});
