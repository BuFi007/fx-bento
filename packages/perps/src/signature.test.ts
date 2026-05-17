import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";

import { buildPerpIntentTypedData, verifyPerpIntentSignature, type PerpIntent } from ".";

describe("perps EIP-712 helpers", () => {
  test("verifies a signed perp intent", async () => {
    const account = privateKeyToAccount(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    const intent: PerpIntent = {
      wallet: account.address,
      marketId: "USDC/EURC",
      side: "long",
      notionalUsd: 100,
      marginUsd: 20,
      leverage: 5,
      nonce: "nonce-123456",
      deadline: Date.now() + 60_000,
    };
    const verifyingContract = "0x0000000000000000000000000000000000000001";
    const typed = buildPerpIntentTypedData(intent, 84532, verifyingContract);
    const signature = await account.signTypedData(typed);

    await expect(
      verifyPerpIntentSignature({ intent, chainId: 84532, verifyingContract, signature })
    ).resolves.toBe(true);
  });
});
