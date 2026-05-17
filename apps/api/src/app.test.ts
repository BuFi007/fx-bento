import { beforeEach, describe, expect, test } from "bun:test";

import { resetFxBentoRoomsForTests } from "@bufinance/fx-bento-game";
import { resetPerpsStateForTests } from "@bufinance/fx-bento-perps";
import { resetPonderStateForTests } from "@bufinance/fx-bento-ponder";
import { buildPaymentRequirements, encodePaymentEnvelope } from "@bufinance/fx-bento-x402";

import { createApiApp } from "./app";

const alice = "0x00000000000000000000000000000000000000a1";
const bob = "0x00000000000000000000000000000000000000b2";
const payTo = "0x0000000000000000000000000000000000000001";
const commitment = `0x${"ab".repeat(32)}`;
const root = `0x${"cd".repeat(32)}`;
const stateHash = `0x${"11".repeat(32)}`;
const nonce = `0x${"22".repeat(32)}`;
const payout = {
  winnerRoot: root,
  rosterHash: `0x${"33".repeat(32)}`,
  leaderboardHash: `0x${"44".repeat(32)}`,
  scoreRoot: `0x${"55".repeat(32)}`,
  settlementPriceRoot: `0x${"66".repeat(32)}`,
  payoutTotal: "9000000",
  protocolFee: "1000000",
};
const contractAddresses = {
  84532: {
    FXBentoRoomFactory: "0x0000000000000000000000000000000000000001",
    FXBentoRoomEscrow: "0x0000000000000000000000000000000000000002",
    FXBentoCommitmentManager: "0x0000000000000000000000000000000000000003",
    FXBentoSettlementManager: "0x0000000000000000000000000000000000000004",
  },
};
const onchainRoomConfig = {
  poolKey: {
    currency0: "0x0000000000000000000000000000000000000100",
    currency1: "0x0000000000000000000000000000000000000200",
    fee: 500,
    tickSpacing: 10,
    hooks: "0x0000000000000000000000000000000000000300",
  },
  entryToken: "0x0000000000000000000000000000000000000400",
  entryFee: "5000000",
  minPlayers: 2,
  maxPlayers: 4,
  rounds: 1,
  roundDuration: 120,
  lockBuffer: 30,
  startTime: 0,
  rakeBps: 500,
  payoutBps: [10000],
  gridConfigHash: root,
  isPrivate: false,
};

function paymentHeader(toolName: string) {
  const accepted = buildPaymentRequirements({
    amount: "1000",
    payTo,
    network: "eip155:84532",
    description: `FX Bento paid action: ${toolName}`,
  });
  return encodePaymentEnvelope({
    x402Version: 1,
    accepted,
    payload: { payer: alice, settlementRef: "dev-tx" },
  });
}

function request(app: ReturnType<typeof createApiApp>, path: string, init?: RequestInit) {
  return app.request(path, init, { ENVIRONMENT: "test" });
}

describe("FX Bento API", () => {
  beforeEach(() => {
    resetFxBentoRoomsForTests();
    resetPerpsStateForTests();
    resetPonderStateForTests();
  });

  test("creates a room, joins players, commits, and prepares settlement", async () => {
    const app = createApiApp();
    const created = await request(app, "/fx-bento/dev/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: "USDC/EURC", minPlayers: 2, maxPlayers: 4 }),
    });
    expect(created.status).toBe(201);
    const room = await created.json();

    for (const player of [alice, bob]) {
      const joined = await request(app, `/fx-bento/dev/rooms/${room.id}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player }),
      });
      expect(joined.status).toBe(200);
    }

    const committed = await request(app, `/fx-bento/dev/rooms/${room.id}/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: alice, roundIndex: 0, commitment }),
    });
    expect(committed.status).toBe(200);

    const settled = await request(app, `/fx-bento/dev/rooms/${room.id}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resultsRoot: root }),
    });
    expect(settled.status).toBe(200);
    expect(await settled.json()).toMatchObject({ status: "settling" });
  });

  test("maps domain errors to API errors instead of 500s", async () => {
    const app = createApiApp();
    const created = await request(app, "/fx-bento/dev/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: "USDC/EURC", minPlayers: 2, maxPlayers: 4 }),
    });
    const room = await created.json();
    const committed = await request(app, `/fx-bento/dev/rooms/${room.id}/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: alice, roundIndex: 0, commitment }),
    });
    expect(committed.status).toBe(409);
    expect(await committed.json()).toMatchObject({ success: false });
  });

  test("disables simulator mutation routes in production", async () => {
    const previousEnvironment = process.env.ENVIRONMENT;
    process.env.ENVIRONMENT = "production";
    try {
      const app = createApiApp();
      const created = await app.request(
        "/fx-bento/dev/rooms",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ marketId: "USDC/EURC", minPlayers: 2, maxPlayers: 4 }),
        },
        { ENVIRONMENT: "production" }
      );
      expect(created.status).toBe(403);
      expect(await created.json()).toMatchObject({
        success: false,
        error: { code: "DEV_SIMULATOR_DISABLED" },
      });
    } finally {
      if (previousEnvironment) {
        process.env.ENVIRONMENT = previousEnvironment;
      } else {
        delete process.env.ENVIRONMENT;
      }
    }
  });

  test("returns transaction requests on canonical FX Bento routes", async () => {
    const previousAddresses = process.env.CONTRACT_ADDRESSES_JSON;
    process.env.CONTRACT_ADDRESSES_JSON = JSON.stringify(contractAddresses);
    try {
      const app = createApiApp();
      const created = await request(app, "/fx-bento/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(onchainRoomConfig),
      });
      expect(created.status).toBe(200);
      expect(await created.json()).toMatchObject({
        transaction: { contractName: "FXBentoRoomFactory", functionName: "createRoom" },
      });

      const joined = await request(app, "/fx-bento/rooms/7/join", { method: "POST" });
      expect(joined.status).toBe(200);
      expect(await joined.json()).toMatchObject({
        transaction: { contractName: "FXBentoRoomEscrow", functionName: "joinRoom" },
      });

      const committed = await request(app, "/fx-bento/rooms/7/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roundIndex: 0, commitment }),
      });
      expect(committed.status).toBe(200);
      expect(await committed.json()).toMatchObject({
        transaction: { contractName: "FXBentoCommitmentManager", functionName: "commitSelection" },
      });

      const revealed = await request(app, "/fx-bento/rooms/7/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roundIndex: 0,
          selection: { rows: [1], cols: [2], chipCount: 1, clientStateHash: stateHash },
          nonce,
        }),
      });
      expect(revealed.status).toBe(200);
      expect(await revealed.json()).toMatchObject({
        transaction: { contractName: "FXBentoCommitmentManager", functionName: "revealSelection" },
      });

      const settled = await request(app, "/fx-bento/rooms/7/settle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resultsRoot: root, metadataURI: "ipfs://results", payout }),
      });
      expect(settled.status).toBe(200);
      expect(await settled.json()).toMatchObject({
        transaction: { contractName: "FXBentoSettlementManager", functionName: "submitResults" },
      });
    } finally {
      if (previousAddresses) {
        process.env.CONTRACT_ADDRESSES_JSON = previousAddresses;
      } else {
        delete process.env.CONTRACT_ADDRESSES_JSON;
      }
    }
  });

  test("uses FX_BENTO deployment env aliases for transaction prep", async () => {
    const previous = {
      CONTRACT_ADDRESSES_JSON: process.env.CONTRACT_ADDRESSES_JSON,
      FX_BENTO_CHAIN_ID: process.env.FX_BENTO_CHAIN_ID,
      FX_BENTO_FACTORY_ADDRESS: process.env.FX_BENTO_FACTORY_ADDRESS,
      FX_BENTO_ESCROW_ADDRESS: process.env.FX_BENTO_ESCROW_ADDRESS,
      FX_BENTO_COMMITMENT_MANAGER_ADDRESS: process.env.FX_BENTO_COMMITMENT_MANAGER_ADDRESS,
      FX_BENTO_SETTLEMENT_ADDRESS: process.env.FX_BENTO_SETTLEMENT_ADDRESS,
    };
    delete process.env.CONTRACT_ADDRESSES_JSON;
    process.env.FX_BENTO_CHAIN_ID = "84532";
    process.env.FX_BENTO_FACTORY_ADDRESS = contractAddresses[84532].FXBentoRoomFactory;
    process.env.FX_BENTO_ESCROW_ADDRESS = contractAddresses[84532].FXBentoRoomEscrow;
    process.env.FX_BENTO_COMMITMENT_MANAGER_ADDRESS = contractAddresses[84532].FXBentoCommitmentManager;
    process.env.FX_BENTO_SETTLEMENT_ADDRESS = contractAddresses[84532].FXBentoSettlementManager;
    try {
      const app = createApiApp();
      const created = await request(app, "/fx-bento/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(onchainRoomConfig),
      });
      expect(created.status).toBe(200);
      expect(await created.json()).toMatchObject({
        transaction: { contractName: "FXBentoRoomFactory", functionName: "createRoom" },
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value) process.env[key] = value;
        else delete process.env[key];
      }
    }
  });

  test("reads FX Bento rooms from configured Ponder GraphQL", async () => {
    const previousUrl = process.env.PONDER_GRAPHQL_URL;
    const previousFetch = globalThis.fetch;
    process.env.PONDER_GRAPHQL_URL = "http://ponder.test/graphql";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            fxBentoRooms: {
              items: [
                {
                  id: "84532:1",
                  chainId: 84532,
                  roomId: "1",
                  status: "active",
                  playerCount: 2,
                  updatedAt: "120",
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch;
    try {
      const app = createApiApp();
      const response = await request(app, "/fx-bento/rooms");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        rooms: [{ chainId: 84532, roomId: "1", status: "active", playerCount: 2 }],
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl) {
        process.env.PONDER_GRAPHQL_URL = previousUrl;
      } else {
        delete process.env.PONDER_GRAPHQL_URL;
      }
    }
  });

  test("gates paid perps quote behind x402", async () => {
    const app = createApiApp();
    const missing = await request(app, "/perps/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: "USDC/EURC", side: "long", notionalUsd: 100, leverage: 5 }),
    });
    expect(missing.status).toBe(402);

    const paid = await request(app, "/perps/quote", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Payment-Signature": paymentHeader("quote_perp_trade"),
      },
      body: JSON.stringify({ marketId: "USDC/EURC", side: "long", notionalUsd: 100, leverage: 5 }),
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ quote: { marketId: "USDC/EURC", marginUsd: 20 } });
  });
});
