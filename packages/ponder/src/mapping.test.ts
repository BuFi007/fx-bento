import { beforeEach, describe, expect, test } from "bun:test";

import {
  eventId,
  indexerHealth,
  inspectFxBentoIndexedRoom,
  inspectFxBentoMarketSnapshots,
  inspectPonderState,
  createPonderGraphqlReadSource,
  createPonderSqlReadSource,
  recordFxBentoContractEvent,
  recordIndexedEvent,
  resetPonderStateForTests,
} from ".";

const alice = "0x00000000000000000000000000000000000000a1";
const txHash = `0x${"ab".repeat(32)}` as `0x${string}`;
const poolId = `0x${"12".repeat(32)}` as `0x${string}`;
const root = `0x${"cd".repeat(32)}` as `0x${string}`;

describe("Ponder mapping helpers", () => {
  beforeEach(() => resetPonderStateForTests());

  test("creates stable event ids", () => {
    expect(eventId("0xABC", 7)).toBe("0xabc-7");
  });

  test("records and filters indexed events", () => {
    recordIndexedEvent({
      id: eventId(txHash, 1),
      kind: "fxBento.roomCreated",
      txHash,
      logIndex: 1,
      blockNumber: 10n,
      roomId: "room_1",
      payload: {},
    });
    expect(inspectPonderState({ roomId: "room_1" })).toHaveLength(1);
  });

  test("normalizes room lifecycle events into a room read model", () => {
    recordFxBentoContractEvent({
      contractName: "FXBentoRoomFactory",
      eventName: "RoomCreated",
      txHash,
      logIndex: 1,
      blockNumber: 10n,
      blockTimestamp: 100n,
      args: {
        roomId: 1n,
        poolId,
        entryToken: "0x0000000000000000000000000000000000000001",
        entryFee: 5_000_000n,
      },
    });
    recordFxBentoContractEvent({
      contractName: "FXBentoRoomEscrow",
      eventName: "RoomJoined",
      txHash,
      logIndex: 2,
      blockNumber: 11n,
      blockTimestamp: 110n,
      args: { roomId: 1n, player: alice },
    });
    recordFxBentoContractEvent({
      contractName: "FXBentoRoomEscrow",
      eventName: "RoomLocked",
      txHash,
      logIndex: 3,
      blockNumber: 12n,
      blockTimestamp: 120n,
      args: { roomId: 1n, escrowed: 5_000_000n },
    });
    recordFxBentoContractEvent({
      contractName: "FXBentoSettlementManager",
      eventName: "ResultsSubmitted",
      txHash,
      logIndex: 4,
      blockNumber: 13n,
      blockTimestamp: 130n,
      args: { roomId: 1n, resultsRoot: root, metadataURI: "ipfs://results" },
    });

    const room = inspectFxBentoIndexedRoom({ roomId: "1" });
    expect(room).toMatchObject({
      status: "settling",
      playerCount: 1,
      escrowedAmount: "5000000",
      results: { root, metadataURI: "ipfs://results" },
    });
    expect(room?.players[0]).toMatchObject({ wallet: alice, status: "joined" });
  });

  test("records market snapshots from hook events", () => {
    recordFxBentoContractEvent({
      contractName: "FXBentoHook",
      eventName: "FXBentoMarketSnapshot",
      txHash,
      logIndex: 1,
      blockNumber: 10n,
      blockTimestamp: 100n,
      args: { poolId, snapshotId: 1n, sqrtPriceX96: 123n, tick: -50, timestamp: 100n, volatility: 8n },
    });

    expect(inspectFxBentoMarketSnapshots({ poolId })).toEqual([
      expect.objectContaining({ poolId, sqrtPriceX96: "123", tick: "-50", volatility: "8" }),
    ]);
    expect(indexerHealth()).toMatchObject({ eventCount: 1, marketSnapshotCount: 1 });
  });

  test("records current settlement and rescue events", () => {
    recordFxBentoContractEvent({
      contractName: "FXBentoRoomFactory",
      eventName: "RoomCreated",
      txHash,
      logIndex: 1,
      blockNumber: 10n,
      blockTimestamp: 100n,
      args: {
        roomId: 1n,
        poolId,
        entryToken: "0x0000000000000000000000000000000000000001",
        entryFee: 5_000_000n,
      },
    });
    recordFxBentoContractEvent({
      contractName: "FXBentoSettlementManager",
      eventName: "ResultsChallenged",
      txHash,
      logIndex: 2,
      blockNumber: 11n,
      blockTimestamp: 110n,
      args: { roomId: 1n, proof: "0x1234" },
    });
    recordFxBentoContractEvent({
      contractName: "FXBentoSettlementManager",
      eventName: "ChallengeResolved",
      txHash,
      logIndex: 3,
      blockNumber: 12n,
      blockTimestamp: 120n,
      args: { roomId: 1n, accepted: false },
    });
    recordFxBentoContractEvent({
      contractName: "FXBentoRoomEscrow",
      eventName: "RoomSettled",
      txHash,
      logIndex: 4,
      blockNumber: 13n,
      blockTimestamp: 130n,
      args: { roomId: 1n, resultsRoot: root, payoutSchemaHash: root, payoutTotal: 4_500_000n, protocolFee: 500_000n },
    });

    expect(inspectFxBentoIndexedRoom({ roomId: "1" })).toMatchObject({
      status: "settled",
      protocolFee: "500000",
      results: { root, challenged: false },
    });

    recordFxBentoContractEvent({
      contractName: "FXBentoSettlementManager",
      eventName: "SettlementRescued",
      txHash,
      logIndex: 5,
      blockNumber: 14n,
      blockTimestamp: 140n,
      args: { roomId: 1n },
    });

    expect(inspectFxBentoIndexedRoom({ roomId: "1" })?.status).toBe("cancelled");
  });

  test("reads normalized room detail from Ponder GraphQL", async () => {
    const source = createPonderGraphqlReadSource({
      endpoint: "http://ponder.test/graphql",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            data: {
              fxBentoRooms: {
                items: [
                  {
                    id: "84532:1",
                    chainId: 84532,
                    roomId: "1",
                    poolId,
                    entryToken: "0x0000000000000000000000000000000000000001",
                    entryFee: "5000000",
                    status: "active",
                    playerCount: 1,
                    escrowedAmount: "5000000",
                    protocolFee: null,
                    settlementRoot: null,
                    resultsMetadataUri: null,
                    resultsChallenged: false,
                    resultsFinalized: false,
                    updatedAt: "120",
                  },
                ],
              },
              fxBentoRoomPlayers: {
                items: [{ player: alice, status: "joined", joinedAt: "110", updatedAt: "110" }],
              },
              fxBentoRounds: {
                items: [{ roomId: "1", roundIndex: 0, status: "active", startTime: "120", updatedAt: "120" }],
              },
              fxBentoCommitments: {
                items: [{ roomId: "1", roundIndex: 0, player: alice, commitment: root, committedTxHash: txHash }],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
    });

    const room = await source.inspectFxBentoRoom({ chainId: 84532, roomId: "1" });
    expect(room).toMatchObject({
      chainId: 84532,
      roomId: "1",
      status: "active",
      playerCount: 1,
      players: [{ wallet: alice, status: "joined" }],
      rounds: [{ roundIndex: 0, commitments: [{ wallet: alice, commitment: root, txHash }] }],
    });
  });

  test("reads normalized room detail and snapshots from Ponder SQL", async () => {
    const source = createPonderSqlReadSource({
      sql: async (strings) => {
        const query = strings.join("?");
        if (query.includes("from fx_bento_room_player")) {
          return [{ player: alice, status: "joined", joined_at: "110", updated_at: "110" }];
        }
        if (query.includes("from fx_bento_round")) {
          return [{ room_id: "1", round_index: 0, status: "active", start_time: "120", updated_at: "120" }];
        }
        if (query.includes("from fx_bento_commitment")) {
          return [{ room_id: "1", round_index: 0, player: alice, commitment: root, committed_tx_hash: txHash }];
        }
        if (query.includes("from fx_bento_market_snapshot")) {
          return [
            {
              id: "snapshot-1",
              chain_id: 84532,
              pool_id: poolId,
              sqrt_price_x96: "123",
              tick: -50,
              timestamp: "130",
              volatility: "8",
              tx_hash: txHash,
            },
          ];
        }
        if (query.includes("from fx_bento_event")) {
          return [{ block_number: "777", timestamp: String(Math.floor(Date.now() / 1000) - 5) }];
        }
        if (query.includes("from fx_bento_room")) {
          return [
            {
              id: "84532:1",
              chain_id: 84532,
              room_id: "1",
              pool_id: poolId,
              entry_token: "0x0000000000000000000000000000000000000001",
              entry_fee: "5000000",
              status: "active",
              player_count: 1,
              escrowed_amount: "5000000",
              protocol_fee: null,
              settlement_root: null,
              results_metadata_uri: null,
              results_challenged: false,
              results_finalized: false,
              updated_at: "120",
            },
          ];
        }
        return [];
      },
    });

    const room = await source.inspectFxBentoRoom({ chainId: 84532, roomId: "1" });
    expect(room).toMatchObject({
      chainId: 84532,
      roomId: "1",
      status: "active",
      playerCount: 1,
      players: [{ wallet: alice, status: "joined" }],
      rounds: [{ roundIndex: 0, commitments: [{ wallet: alice, commitment: root, txHash }] }],
    });

    await expect(source.listFxBentoRooms(84532)).resolves.toHaveLength(1);
    await expect(source.inspectFxBentoMarketSnapshots({ chainId: 84532, poolId })).resolves.toEqual([
      expect.objectContaining({ poolId, sqrtPriceX96: "123", tick: "-50" }),
    ]);
    await expect(source.health()).resolves.toMatchObject({ status: "sql", ok: true, latestBlockNumber: "777" });
  });

  test("reports direct SQL health from Ponder checkpoints when available", async () => {
    const blockTimestamp = Math.floor(Date.now() / 1000) - 4;
    const checkpoint = [
      String(blockTimestamp).padStart(10, "0"),
      "84532".padStart(16, "0"),
      "888".padStart(16, "0"),
      "0".padStart(16, "0"),
      "5",
      "0".padStart(16, "0"),
    ].join("");
    const source = createPonderSqlReadSource({
      sql: async (strings) => {
        const query = strings.join("?");
        if (query.includes("from _ponder_checkpoint")) {
          return [{ latest_checkpoint: checkpoint }];
        }
        if (query.includes("from fx_bento_event")) {
          return [{ block_number: "777", timestamp: String(blockTimestamp - 20) }];
        }
        return [];
      },
    });

    const health = await source.health();
    expect(health).toMatchObject({
      status: "sql",
      ok: true,
      source: "checkpoint",
      latestBlockNumber: "888",
      latestEventBlockNumber: "777",
    });
    expect(health.lagSeconds).toBeGreaterThanOrEqual(0);
    expect(health.lagSeconds).toBeLessThan(30);
  });

  test("reports remote Ponder lag from the latest indexed event", async () => {
    const latestTimestamp = String(Math.floor(Date.now() / 1000) - 5);
    const source = createPonderGraphqlReadSource({
      endpoint: "http://ponder.test/graphql",
      fetcher: async (_endpoint, init) => {
        const request = JSON.parse(String(init?.body)) as { query: string };
        expect(request.query).toContain('orderBy: "blockNumber"');
        expect(request.query).toContain('orderDirection: "desc"');
        return new Response(
          JSON.stringify({
            data: {
              fxBentoEvents: {
                items: [{ blockNumber: "777", timestamp: latestTimestamp }],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
    });

    const health = await source.health();
    expect(health).toMatchObject({
      status: "remote",
      endpoint: "http://ponder.test/graphql",
      ok: true,
      latestBlockNumber: "777",
    });
    expect(health.lagSeconds).toBeGreaterThanOrEqual(0);
    expect(health.lagSeconds).toBeLessThan(30);
  });
});
