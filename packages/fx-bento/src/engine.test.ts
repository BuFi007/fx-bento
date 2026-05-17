import { describe, expect, test } from "bun:test";

import {
  buildSelectedTilesHash,
  buildSelectionCommitment,
  buildSettlementEvidence,
  buildSettlementResultTree,
  prepareClaimPrizeTransaction,
  prepareJoinRoomTransaction,
  reconcileFxBentoRoomState,
  safetyCheckFxBentoTransaction,
  serializeTransactionRequest,
} from ".";

const engine = {
  chainId: 84532,
  addresses: {
    FXBentoRoomEscrow: "0x0000000000000000000000000000000000000001",
    FXBentoCommitmentManager: "0x0000000000000000000000000000000000000002",
  },
} as const;
const alice = "0x00000000000000000000000000000000000000a1";
const bob = "0x00000000000000000000000000000000000000b2";
const stateHash = `0x${"11".repeat(32)}` as `0x${string}`;
const nonce = `0x${"22".repeat(32)}` as `0x${string}`;
const resultsRoot = `0x${"33".repeat(32)}` as `0x${string}`;

describe("FX Bento contract engine", () => {
  test("builds join transaction calldata", () => {
    const tx = prepareJoinRoomTransaction(engine, 7n);
    expect(tx).toMatchObject({
      contractName: "FXBentoRoomEscrow",
      to: engine.addresses.FXBentoRoomEscrow,
      functionName: "joinRoom",
      chainId: 84532,
    });
    expect(tx.data.startsWith("0x")).toBe(true);
    expect(serializeTransactionRequest(tx).args).toEqual(["7"]);
  });

  test("matches Solidity commitment hash shape", () => {
    const selectedTilesHash = buildSelectedTilesHash({
      rows: [1, 2],
      cols: [3, 4],
      chipCount: 2,
      clientStateHash: stateHash,
    });
    const commitment = buildSelectionCommitment({
      chainId: engine.chainId,
      roomId: 7n,
      roundIndex: 1,
      player: alice,
      selectedTilesHash,
      nonce,
    });
    expect(selectedTilesHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(commitment).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("builds Merkle root and claim transaction for prize allocations", () => {
    const tree = buildSettlementResultTree(
      7n,
      [
        { roomId: 7n, player: alice, amount: 75n, score: 10n, rank: 1 },
        { roomId: 7n, player: bob, amount: 25n, score: 4n, rank: 2 },
      ],
      110n,
      10n
    );
    expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(tree.totalPrizePayouts).toBe(100n);
    const claim = prepareClaimPrizeTransaction(engine, {
      roomId: 7n,
      amount: tree.allocations[0]?.amount ?? 0n,
      proof: tree.allocations[0]?.proof ?? [],
    });
    expect(claim.functionName).toBe("claimPrize");
  });

  test("rejects result trees that exceed escrow after protocol fee", () => {
    expect(() =>
      buildSettlementResultTree(7n, [{ roomId: 7n, player: alice, amount: 101n }], 100n, 1n)
    ).toThrow("payout_exceeds_escrow");
  });

  test("runs simulation and contract room reconciliation when a client is supplied", async () => {
    const tx = prepareJoinRoomTransaction(
      { ...engine, addresses: { ...engine.addresses, FXBentoRoomFactory: "0x0000000000000000000000000000000000000003" } },
      7n
    );
    const calls: string[] = [];
    const safety = await safetyCheckFxBentoTransaction({
      engine: { ...engine, addresses: { ...engine.addresses, FXBentoRoomFactory: "0x0000000000000000000000000000000000000003" } },
      request: tx,
      roomId: 7n,
      indexedRoom: { status: "lobby", playerCount: 1 },
      client: {
        async readContract(args) {
          calls.push(args.functionName);
          return { status: 0 };
        },
        async simulateContract(args) {
          calls.push(args.functionName);
          return { result: true };
        },
      },
    });

    expect(calls).toEqual(["getRoom", "joinRoom"]);
    expect(safety).toMatchObject({
      reconciliation: { status: "passed", indexedStatus: "lobby", contractStatus: "lobby" },
      simulation: { status: "passed", result: true },
    });
  });

  test("rejects mismatched indexed room status before simulation", async () => {
    await expect(
      reconcileFxBentoRoomState({
        engine,
        roomId: 7n,
        functionName: "joinRoom",
        indexedRoom: { status: "active" },
      })
    ).rejects.toThrow("indexed_room_state_mismatch");
  });

  test("validates public settlement evidence payload totals", () => {
    const evidence = buildSettlementEvidence({
      chainId: 84532,
      roomId: 7n,
      resultsRoot,
      metadataURI: "ipfs://results",
      challengeWindowEndsAt: new Date(Date.now() + 60_000).toISOString(),
      rounds: [{ roundIndex: 0, anchorPrice: "100", settlementPrice: "101" }],
      allocations: [{ roomId: 7n, player: alice, amount: 90n, score: 10n, rank: 1 }],
      totalPrizePayouts: 90n,
      protocolFee: 10n,
    });
    expect(evidence).toMatchObject({
      version: "fx-bento-settlement-evidence-v1",
      scorerVersion: "fx-bento-scoring-v1",
      totalPrizePayouts: 90n,
    });
  });
});
