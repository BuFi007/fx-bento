import {
  CommitSelectionSchema,
  CreateFxBentoRoomSchema,
  JoinFxBentoRoomSchema,
  OnchainRoomConfigSchema,
  RevealSelectionSchema,
  SettlementPayoutRootSchema,
  SettleFxBentoRoomSchema,
  TileSelectionSchema,
  commitFxBentoSelection,
  createFxBentoPublicClient,
  createFxBentoRoom,
  getFxBentoClaimProof,
  getFxBentoLeaderboard,
  getFxBentoRoom,
  joinFxBentoRoom,
  listFxBentoRooms,
  prepareCommitSelectionTransaction,
  prepareClaimPrizeTransaction,
  prepareCreateRoomTransaction,
  prepareFinalizeResultsTransaction,
  prepareJoinRoomTransaction,
  prepareLeaveRoomTransaction,
  prepareRevealSelectionTransaction,
  prepareRefundTransaction,
  prepareSubmitResultsTransaction,
  revealFxBentoSelection,
  safetyCheckFxBentoTransaction,
  serializeTransactionRequest,
  settleFxBentoRoom,
  type FxBentoContractEngineConfig,
  type FxBentoTransactionRequest,
} from "@bufinance/fx-bento-game";
import { chainContractAddressesFromEnv, resolveDeploymentRpcUrl } from "@bufinance/fx-bento-contracts";
import { readEnv } from "@bufinance/fx-bento-env";
import { ensureLiveblocksRoom } from "@bufinance/fx-bento-liveblocks";
import {
  createPonderReadSource,
} from "@bufinance/fx-bento-ponder";
import { HexSchema } from "@bufinance/fx-bento-shared-types";
import { Hono } from "hono";
import z from "zod";

import { parseJson } from "../lib/validation";

export const fxBentoRoutes = new Hono();

const RoomClaimSchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  amount: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative(), z.bigint()]).optional(),
  proof: z.array(HexSchema).optional(),
});

const ChainQuerySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
});

const CommitTransactionSchema = z.object({
  roundIndex: z.coerce.number().int().min(0),
  commitment: HexSchema,
});

const RevealTransactionSchema = z.object({
  roundIndex: z.coerce.number().int().min(0),
  selection: TileSelectionSchema,
  nonce: HexSchema,
});

const SubmitResultsSchema = z.object({
  resultsRoot: HexSchema,
  metadataURI: z.string().min(1).default("ipfs://pending"),
  payout: SettlementPayoutRootSchema,
  attestation: HexSchema.optional(),
});

fxBentoRoutes.get("/fx-bento/rooms", async (c) => {
  const indexedRooms = await ponderSourceFromEnv().listFxBentoRooms();
  return c.json({ rooms: indexedRooms.length > 0 ? indexedRooms : simulatorFallbackRooms() });
});

fxBentoRoutes.post("/fx-bento/rooms/prepare", async (c) => {
  const body = await parseJson(c, OnchainRoomConfigSchema);
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareCreateRoomTransaction(engine, body);
  return c.json(await transactionPayload(engine, request));
});

fxBentoRoutes.post("/fx-bento/rooms", async (c) => {
  const body = await parseJson(c, OnchainRoomConfigSchema);
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareCreateRoomTransaction(engine, body);
  return c.json(await transactionPayload(engine, request));
});

fxBentoRoutes.post("/fx-bento/dev/rooms", async (c) => {
  assertDevSimulatorEnabled();
  const body = await parseJson(c, CreateFxBentoRoomSchema);
  const room = createFxBentoRoom(body);
  await ensureLiveblocksRoom({
    roomId: room.liveblocksRoomId,
    title: `FX Bento ${room.marketId}`,
    url: `/fx-bento/rooms/${room.id}`,
  });
  return c.json(room, 201);
});

fxBentoRoutes.get("/fx-bento/rooms/:id", async (c) => {
  const indexed = await ponderSourceFromEnv().inspectFxBentoRoom({ roomId: c.req.param("id") });
  const room = indexed ?? simulatorFallbackRoom(c.req.param("id"));
  return room ? c.json(room) : c.json({ error: "room_not_found" }, 404);
});

fxBentoRoutes.get("/fx-bento/rooms/:id/players", async (c) => {
  const room = await ponderSourceFromEnv().inspectFxBentoRoom({ roomId: c.req.param("id") });
  return room ? c.json({ players: room.players }) : c.json({ error: "room_not_found" }, 404);
});

fxBentoRoutes.get("/fx-bento/rooms/:id/rounds", async (c) => {
  const room = await ponderSourceFromEnv().inspectFxBentoRoom({ roomId: c.req.param("id") });
  return room ? c.json({ rounds: room.rounds }) : c.json({ error: "room_not_found" }, 404);
});

fxBentoRoutes.post("/fx-bento/rooms/:id/join", async (c) => {
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareJoinRoomTransaction(engine, c.req.param("id"));
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.post("/fx-bento/dev/rooms/:id/join", async (c) => {
  assertDevSimulatorEnabled();
  const body = await parseJson(c, JoinFxBentoRoomSchema);
  return c.json(joinFxBentoRoom(c.req.param("id"), body));
});

fxBentoRoutes.post("/fx-bento/rooms/:id/join/prepare", async (c) => {
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareJoinRoomTransaction(engine, c.req.param("id"));
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.post("/fx-bento/rooms/:id/refund/prepare", async (c) => {
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareRefundTransaction(engine, c.req.param("id"));
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.post("/fx-bento/rooms/:id/commit", async (c) => {
  const body = await parseJson(c, CommitTransactionSchema);
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareCommitSelectionTransaction(engine, {
    roomId: c.req.param("id"),
    roundIndex: body.roundIndex,
    commitment: body.commitment,
  });
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.post("/fx-bento/dev/rooms/:id/commit", async (c) => {
  assertDevSimulatorEnabled();
  const body = await parseJson(c, CommitSelectionSchema);
  return c.json(commitFxBentoSelection(c.req.param("id"), body));
});

fxBentoRoutes.post("/fx-bento/rooms/:id/reveal", async (c) => {
  const body = await parseJson(c, RevealTransactionSchema);
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareRevealSelectionTransaction(engine, {
    roomId: c.req.param("id"),
    roundIndex: body.roundIndex,
    selection: body.selection,
    nonce: body.nonce,
  });
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.post("/fx-bento/dev/rooms/:id/reveal", async (c) => {
  assertDevSimulatorEnabled();
  const body = await parseJson(c, RevealSelectionSchema);
  return c.json(revealFxBentoSelection(c.req.param("id"), body));
});

fxBentoRoutes.get("/fx-bento/rooms/:id/leaderboard", async (c) => {
  const indexed = await ponderSourceFromEnv().inspectFxBentoRoom({ roomId: c.req.param("id") });
  if (indexed) {
    return c.json({
      leaderboard: indexed.players.map((player) => ({
        player: player.wallet,
        score: 0,
        status: player.status,
      })),
      source: "indexed",
    });
  }
  const room = simulatorFallbackRoom(c.req.param("id"));
  return room
    ? c.json({ leaderboard: getFxBentoLeaderboard(room.id), source: "simulator" })
    : c.json({ error: "room_not_found" }, 404);
});

fxBentoRoutes.post("/fx-bento/rooms/:id/settle", async (c) => {
  const body = await parseJson(c, SubmitResultsSchema);
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareSubmitResultsTransaction(engine, {
    roomId: c.req.param("id"),
    resultsRoot: body.resultsRoot,
    metadataURI: body.metadataURI,
    payout: body.payout,
    attestation: body.attestation,
  });
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.post("/fx-bento/rooms/:id/finalize", async (c) => {
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareFinalizeResultsTransaction(engine, c.req.param("id"));
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.post("/fx-bento/dev/rooms/:id/settle", async (c) => {
  assertDevSimulatorEnabled();
  const body = await parseJson(c, SettleFxBentoRoomSchema);
  return c.json(settleFxBentoRoom(c.req.param("id"), body));
});

fxBentoRoutes.post("/fx-bento/rooms/:id/leave", async (c) => {
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareLeaveRoomTransaction(engine, c.req.param("id"));
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.post("/fx-bento/rooms/:id/refund", async (c) => {
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const engine = engineFromEnv(query.chainId);
  const request = prepareRefundTransaction(engine, c.req.param("id"));
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.get("/fx-bento/rooms/:id/claims/:address", async (c) => {
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const room = await ponderSourceFromEnv().inspectFxBentoRoom({
    chainId: query.chainId,
    roomId: c.req.param("id"),
  });
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const address = c.req.param("address").toLowerCase();
  const player = room.players.find((item) => item.wallet.toLowerCase() === address);
  const proof = await getFxBentoClaimProof({
    chainId: query.chainId ?? room.chainId,
    roomId: room.roomId,
    player: c.req.param("address"),
  });
  return c.json({
    roomId: room.roomId,
    address,
    claimable: !!player && room.results.finalized && !!proof?.finalized && !player.prizeClaimedAmount,
    claimed: !!player?.prizeClaimedAmount,
    amount: proof?.amount ?? player?.prizeClaimedAmount ?? "0",
    proof: proof?.proof ?? [],
    proofReady: !!proof?.proofReady,
    settlementRoot: proof?.settlementRoot ?? room.settlementRoot,
    source: proof ? "settlement_result_store" : "indexed",
  });
});

fxBentoRoutes.post("/fx-bento/rooms/:id/claim", async (c) => {
  const body = await parseJson(c, RoomClaimSchema);
  const engine = engineFromEnv(body.chainId);
  const proof = await getFxBentoClaimProof({
    chainId: engine.chainId,
    roomId: c.req.param("id"),
    player: (readEnv().SIMULATION_ACCOUNT_ADDRESS ?? readEnv().TREASURY_ADDRESS ?? "0x0000000000000000000000000000000000000001") as `0x${string}`,
  });
  const amount = body.amount ?? proof?.amount;
  const proofItems = body.proof ?? proof?.proof;
  if (amount === undefined || proofItems === undefined) {
    return c.json({ error: "claim_proof_not_ready" }, 409);
  }
  const request = prepareClaimPrizeTransaction(engine, {
    roomId: c.req.param("id"),
    amount,
    proof: proofItems,
  });
  return c.json(await transactionPayload(engine, request, { roomId: c.req.param("id") }));
});

fxBentoRoutes.get("/fx-bento/markets/:poolId/snapshots", async (c) => {
  const query = ChainQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  return c.json({
    snapshots: await ponderSourceFromEnv().inspectFxBentoMarketSnapshots({
      chainId: query.chainId,
      poolId: c.req.param("poolId") as `0x${string}`,
    }),
  });
});

function engineFromEnv(chainId?: number) {
  const env = readEnv();
  const resolvedChainId = chainId ?? env.FX_BENTO_CHAIN_ID ?? Number(env.X402_NETWORK.split(":")[1] ?? 84532);
  return {
    chainId: resolvedChainId,
    addresses: chainContractAddressesFromEnv(env, resolvedChainId),
  };
}

async function transactionPayload(
  engine: FxBentoContractEngineConfig,
  request: FxBentoTransactionRequest,
  options: { roomId?: string } = {}
) {
  const env = readEnv();
  const rpcUrl = resolveDeploymentRpcUrl(env, engine.chainId) ?? env.MARKET_DATA_RPC_URL;
  const client = rpcUrl ? createFxBentoPublicClient({ chainId: engine.chainId, rpcUrl }) : undefined;
  const indexedRoom = options.roomId
    ? await ponderSourceFromEnv().inspectFxBentoRoom({ chainId: engine.chainId, roomId: options.roomId })
    : null;
  const safety = await safetyCheckFxBentoTransaction({
    engine,
    request,
    roomId: options.roomId,
    indexedRoom,
    client,
    account: (env.SIMULATION_ACCOUNT_ADDRESS ?? env.TREASURY_ADDRESS) as `0x${string}` | undefined,
  });
  return { transaction: serializeTransactionRequest(request), safety };
}

function ponderSourceFromEnv() {
  const env = readEnv();
  return createPonderReadSource({ graphqlUrl: env.PONDER_GRAPHQL_URL, sqlUrl: env.PONDER_SQL_URL });
}

function assertDevSimulatorEnabled() {
  const env = readEnv();
  if (env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test") {
    throw new Error("dev_simulator_disabled");
  }
}

function simulatorFallbackRooms() {
  const env = readEnv();
  if (env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test") return [];
  return listFxBentoRooms();
}

function simulatorFallbackRoom(id: string) {
  const env = readEnv();
  if (env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test") return null;
  return getFxBentoRoom(id);
}
