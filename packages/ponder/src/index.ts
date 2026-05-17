import { ROOM_STATUS_BY_ID, type ContractName } from "@bufinance/fx-bento-contracts";
import { AddressSchema, HexSchema, MarketIdSchema, nowIso } from "@bufinance/fx-bento-shared-types";
import postgres from "postgres";
import z from "zod";

export const IndexedEventKindSchema = z.enum([
  "fxBento.roomCreated",
  "fxBento.roomStatusUpdated",
  "fxBento.entryTokenAllowed",
  "fxBento.limitsUpdated",
  "fxBento.escrowUpdated",
  "fxBento.playerJoined",
  "fxBento.playerLeft",
  "fxBento.roomCancelled",
  "fxBento.roomStarted",
  "fxBento.roomLocked",
  "fxBento.commitmentSubmitted",
  "fxBento.selectionRevealed",
  "fxBento.roundStarted",
  "fxBento.anchorRecorded",
  "fxBento.roundSettled",
  "fxBento.settlementRecorded",
  "fxBento.resultsSubmitted",
  "fxBento.resultsChallenged",
  "fxBento.challengeResolved",
  "fxBento.resultsFinalized",
  "fxBento.settlementRescueDelayUpdated",
  "fxBento.settlementRescued",
  "fxBento.roomSettled",
  "fxBento.settlementManagerUpdated",
  "fxBento.prizeClaimed",
  "fxBento.refundClaimed",
  "fxBento.protocolRakeClaimed",
  "fxBento.poolInitialized",
  "fxBento.marketSnapshot",
  "fxBento.preSwapContext",
  "fxBento.arcadeFeeVaultUpdated",
  "fxBento.hookPoolAllowedUpdated",
  "fxBento.poolAllowed",
  "fxBento.treasuryUpdated",
  "fxBento.feeNotifierUpdated",
  "fxBento.feeReceived",
  "fxBento.feeSwept",
  "perps.positionOpened",
  "perps.tradeExecuted",
  "perps.fundingUpdated",
  "perps.liquidationCandidate",
  "fxTelarana.borrowCreated",
  "fxTelarana.loanUpdated",
]);

export const IndexedEventSchema = z.object({
  id: z.string().min(1),
  chainId: z.number().int().positive().default(84532),
  contractName: z.string().optional(),
  eventName: z.string().optional(),
  kind: IndexedEventKindSchema,
  txHash: HexSchema,
  logIndex: z.number().int().nonnegative(),
  blockNumber: z.bigint(),
  timestamp: z.string().datetime(),
  marketId: MarketIdSchema.optional(),
  poolId: HexSchema.optional(),
  roomId: z.string().optional(),
  roundIndex: z.number().int().nonnegative().optional(),
  wallet: AddressSchema.optional(),
  payload: z.record(z.unknown()).default({}),
});

export const PonderStateQuerySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  kind: IndexedEventKindSchema.optional(),
  marketId: MarketIdSchema.optional(),
  poolId: HexSchema.optional(),
  roomId: z.string().optional(),
  roundIndex: z.coerce.number().int().nonnegative().optional(),
  wallet: AddressSchema.optional(),
  limit: z.coerce.number().int().positive().max(250).default(50),
});

export const FxBentoContractEventSchema = z.object({
  chainId: z.coerce.number().int().positive().default(84532),
  contractName: z.string().min(1),
  eventName: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  txHash: HexSchema,
  logIndex: z.number().int().nonnegative(),
  blockNumber: z.union([z.bigint(), z.number().int().nonnegative()]).transform(BigInt),
  blockTimestamp: z.union([z.bigint(), z.number().int().nonnegative(), z.string().datetime()]).optional(),
});

export type IndexedEventKind = z.infer<typeof IndexedEventKindSchema>;
export type IndexedEvent = z.infer<typeof IndexedEventSchema>;
export type PonderStateQuery = z.input<typeof PonderStateQuerySchema>;
export type FxBentoContractEvent = z.input<typeof FxBentoContractEventSchema>;

export interface FxBentoRoomReadModel {
  id: string;
  chainId: number;
  roomId: string;
  poolId: string | null;
  entryToken: string | null;
  entryFee: string | null;
  marketId: string | null;
  status: "lobby" | "active" | "settling" | "settled" | "cancelled" | "unknown";
  playerCount: number;
  players: Array<{
    wallet: string;
    status: "joined" | "left" | "refunded";
    joinedAt: string | null;
    leftAt: string | null;
    refundedAt: string | null;
    prizeClaimedAmount: string | null;
  }>;
  escrowedAmount: string | null;
  protocolFee: string | null;
  settlementRoot: string | null;
  results: {
    root: string | null;
    metadataURI: string | null;
    challenged: boolean;
    finalized: boolean;
    submittedAt: string | null;
    finalizedAt: string | null;
  };
  rounds: FxBentoRoundReadModel[];
  updatedAt: string;
}

export interface FxBentoRoundReadModel {
  roomId: string;
  roundIndex: number;
  status: "active" | "settled";
  startTime: string | null;
  lockTime: string | null;
  endTime: string | null;
  anchorPrice: string | null;
  settlementPrice: string | null;
  commitments: Array<{ wallet: string; commitment: string; txHash: string }>;
  reveals: Array<{ wallet: string; selectedTilesHash: string; txHash: string }>;
}

export interface FxBentoMarketSnapshotReadModel {
  id: string;
  chainId: number;
  poolId: string;
  sqrtPriceX96: string;
  tick: string;
  timestamp: string;
  volatility: string;
  txHash: string;
}

export interface PonderReadSource {
  listFxBentoRooms: (chainId?: number) => Promise<FxBentoRoomReadModel[]>;
  inspectFxBentoRoom: (args: { chainId?: number; roomId: string }) => Promise<FxBentoRoomReadModel | null>;
  inspectFxBentoMarketSnapshots: (args?: {
    chainId?: number;
    poolId?: string;
    limit?: number;
  }) => Promise<FxBentoMarketSnapshotReadModel[]>;
  health: () => Promise<
    | ReturnType<typeof indexerHealth>
    | {
        status: "remote";
        endpoint: string;
        ok: boolean;
        error?: string;
        latestBlockNumber?: string | null;
        latestTimestamp?: string | null;
        lagSeconds?: number | null;
        source?: "checkpoint" | "event";
        latestEventBlockNumber?: string | null;
        latestEventTimestamp?: string | null;
      }
    | {
        status: "sql";
        ok: boolean;
        error?: string;
        latestBlockNumber?: string | null;
        latestTimestamp?: string | null;
        lagSeconds?: number | null;
        source?: "checkpoint" | "event";
        latestEventBlockNumber?: string | null;
        latestEventTimestamp?: string | null;
      }
  >;
}

export type PonderFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type PonderSqlClient = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

const indexedEvents: IndexedEvent[] = [];
const rooms = new Map<string, FxBentoRoomReadModel>();
const marketSnapshots = new Map<string, FxBentoMarketSnapshotReadModel>();

const EVENT_KIND_BY_NAME: Record<string, IndexedEventKind> = {
  RoomCreated: "fxBento.roomCreated",
  RoomStatusUpdated: "fxBento.roomStatusUpdated",
  EntryTokenAllowed: "fxBento.entryTokenAllowed",
  LimitsUpdated: "fxBento.limitsUpdated",
  EscrowUpdated: "fxBento.escrowUpdated",
  RoomJoined: "fxBento.playerJoined",
  RoomLeft: "fxBento.playerLeft",
  RoomCancelled: "fxBento.roomCancelled",
  RoomLocked: "fxBento.roomLocked",
  RoomSettled: "fxBento.roomSettled",
  SettlementManagerUpdated: "fxBento.settlementManagerUpdated",
  Refunded: "fxBento.refundClaimed",
  PrizeClaimed: "fxBento.prizeClaimed",
  ProtocolFeeClaimed: "fxBento.protocolRakeClaimed",
  RoundStarted: "fxBento.roundStarted",
  AnchorRecorded: "fxBento.anchorRecorded",
  SettlementRecorded: "fxBento.settlementRecorded",
  SelectionCommitted: "fxBento.commitmentSubmitted",
  SelectionRevealed: "fxBento.selectionRevealed",
  ResultsSubmitted: "fxBento.resultsSubmitted",
  ResultsChallenged: "fxBento.resultsChallenged",
  ChallengeResolved: "fxBento.challengeResolved",
  ResultsFinalized: "fxBento.resultsFinalized",
  SettlementRescueDelayUpdated: "fxBento.settlementRescueDelayUpdated",
  SettlementRescued: "fxBento.settlementRescued",
  PoolInitialized: "fxBento.poolInitialized",
  FXBentoMarketSnapshot: "fxBento.marketSnapshot",
  PreSwapContext: "fxBento.preSwapContext",
  ArcadeFeeVaultUpdated: "fxBento.arcadeFeeVaultUpdated",
  HookPoolAllowedUpdated: "fxBento.hookPoolAllowedUpdated",
  PoolAllowed: "fxBento.poolAllowed",
  TreasuryUpdated: "fxBento.treasuryUpdated",
  FeeNotifierUpdated: "fxBento.feeNotifierUpdated",
  FeeReceived: "fxBento.feeReceived",
  FeeSwept: "fxBento.feeSwept",
};

export function eventId(txHash: string, logIndex: number): string {
  return `${txHash.toLowerCase()}-${logIndex}`;
}

export function recordIndexedEvent(
  event: Omit<
    Partial<IndexedEvent> & Pick<IndexedEvent, "id" | "kind" | "txHash" | "logIndex" | "blockNumber">,
    "timestamp"
  > & { timestamp?: string }
) {
  const parsed = IndexedEventSchema.parse({
    ...event,
    timestamp: event.timestamp ?? nowIso(),
  });
  const existing = indexedEvents.findIndex((item) => item.id === parsed.id);
  if (existing >= 0) indexedEvents[existing] = parsed;
  else indexedEvents.push(parsed);
  return parsed;
}

export function recordFxBentoContractEvent(input: FxBentoContractEvent): IndexedEvent {
  const parsed = FxBentoContractEventSchema.parse(input);
  const kind = EVENT_KIND_BY_NAME[parsed.eventName];
  if (!kind) throw new Error(`unsupported_fx_bento_event:${parsed.contractName}:${parsed.eventName}`);

  const timestamp = normalizeTimestamp(parsed.blockTimestamp);
  const roomId = stringifyArg(parsed.args.roomId);
  const roundIndex = numberArg(parsed.args.roundIndex);
  const wallet = addressArg(parsed.args.player ?? parsed.args.sender ?? parsed.args.treasury);
  const poolId = hexArg(parsed.args.poolId);
  const marketId = typeof parsed.args.marketId === "string" ? parsed.args.marketId : undefined;
  const payload = normalizePayload(parsed.args);

  const event = recordIndexedEvent({
    id: eventId(parsed.txHash, parsed.logIndex),
    chainId: parsed.chainId,
    contractName: parsed.contractName,
    eventName: parsed.eventName,
    kind,
    txHash: parsed.txHash,
    logIndex: parsed.logIndex,
    blockNumber: parsed.blockNumber,
    timestamp,
    marketId,
    poolId,
    roomId,
    roundIndex,
    wallet,
    payload,
  });

  applyFxBentoReadModel(event, parsed.contractName as ContractName);
  return event;
}

export function inspectPonderState(query: PonderStateQuery = {}) {
  const parsed = PonderStateQuerySchema.parse(query);
  return indexedEvents
    .filter((event) => (parsed.chainId ? event.chainId === parsed.chainId : true))
    .filter((event) => (parsed.kind ? event.kind === parsed.kind : true))
    .filter((event) => (parsed.marketId ? event.marketId === parsed.marketId : true))
    .filter((event) => (parsed.poolId ? event.poolId?.toLowerCase() === parsed.poolId.toLowerCase() : true))
    .filter((event) => (parsed.roomId ? event.roomId === parsed.roomId : true))
    .filter((event) => (parsed.roundIndex !== undefined ? event.roundIndex === parsed.roundIndex : true))
    .filter((event) => (parsed.wallet ? event.wallet?.toLowerCase() === parsed.wallet.toLowerCase() : true))
    .slice(-parsed.limit);
}

export function listFxBentoIndexedRooms(chainId?: number): FxBentoRoomReadModel[] {
  return [...rooms.values()].filter((room) => (chainId ? room.chainId === chainId : true));
}

export function inspectFxBentoIndexedRoom(args: { chainId?: number; roomId: string }) {
  if (args.chainId) return rooms.get(roomKey(args.chainId, args.roomId)) ?? null;
  return [...rooms.values()].find((room) => room.roomId === args.roomId) ?? null;
}

export function inspectFxBentoMarketSnapshots(args: { chainId?: number; poolId?: string; limit?: number } = {}) {
  const limit = args.limit ?? 50;
  return [...marketSnapshots.values()]
    .filter((snapshot) => (args.chainId ? snapshot.chainId === args.chainId : true))
    .filter((snapshot) => (args.poolId ? snapshot.poolId.toLowerCase() === args.poolId.toLowerCase() : true))
    .slice(-limit);
}

export function indexerHealth() {
  const updatedAt = indexedEvents.at(-1)?.timestamp ?? null;
  return {
    status: "scaffold",
    eventCount: indexedEvents.length,
    roomCount: rooms.size,
    marketSnapshotCount: marketSnapshots.size,
    updatedAt,
    lagSeconds: updatedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(updatedAt)) / 1000)) : null,
  };
}

export function createPonderMemoryReadSource(): PonderReadSource {
  return {
    listFxBentoRooms: async (chainId) => listFxBentoIndexedRooms(chainId),
    inspectFxBentoRoom: async (args) => inspectFxBentoIndexedRoom(args),
    inspectFxBentoMarketSnapshots: async (args = {}) => inspectFxBentoMarketSnapshots(args),
    health: async () => indexerHealth(),
  };
}

export function createPonderReadSource(
  args: { graphqlUrl?: string | null; sqlUrl?: string | null; fetcher?: PonderFetch } = {}
): PonderReadSource {
  if (args.graphqlUrl) {
    return createPonderGraphqlReadSource({ endpoint: args.graphqlUrl, fetcher: args.fetcher });
  }
  if (args.sqlUrl) {
    return createPonderSqlReadSource({ databaseUrl: args.sqlUrl });
  }
  return createPonderMemoryReadSource();
}

export function createPonderSqlReadSource(args: { databaseUrl?: string; sql?: PonderSqlClient }): PonderReadSource {
  const sql: PonderSqlClient = args.sql ?? (postgres(args.databaseUrl ?? "", { max: 3, prepare: false }) as unknown as PonderSqlClient);

  async function query(strings: TemplateStringsArray, ...values: unknown[]): Promise<Array<Record<string, unknown>>> {
    try {
      return sqlRows(await sql(strings, ...values));
    } catch (error) {
      if (isMissingPonderTable(error)) return [];
      throw error;
    }
  }

  return {
    async listFxBentoRooms(chainId) {
      const rows = chainId
        ? await query`select * from fx_bento_room where chain_id = ${chainId} order by updated_at desc limit 250`
        : await query`select * from fx_bento_room order by updated_at desc limit 250`;
      return rows.map((room) => normalizeSqlRoom(room));
    },

    async inspectFxBentoRoom({ chainId, roomId }) {
      const rooms = chainId
        ? await query`select * from fx_bento_room where chain_id = ${chainId} and room_id = ${roomId} limit 1`
        : await query`select * from fx_bento_room where room_id = ${roomId} limit 1`;
      const room = rooms[0];
      if (!room) return null;
      const resolvedChainId = Number(room.chain_id ?? chainId ?? 0);
      const [players, rounds, commitments] = await Promise.all([
        query`select * from fx_bento_room_player where chain_id = ${resolvedChainId} and room_id = ${roomId} order by updated_at asc`,
        query`select * from fx_bento_round where chain_id = ${resolvedChainId} and room_id = ${roomId} order by round_index asc`,
        query`select * from fx_bento_commitment where chain_id = ${resolvedChainId} and room_id = ${roomId} order by updated_at asc`,
      ]);
      return normalizeSqlRoom(room, players, rounds, commitments);
    },

    async inspectFxBentoMarketSnapshots(options = {}) {
      const limit = options.limit ?? 50;
      const rows = options.chainId && options.poolId
        ? await query`select * from fx_bento_market_snapshot where chain_id = ${options.chainId} and lower(pool_id) = lower(${options.poolId}) order by timestamp desc limit ${limit}`
        : options.chainId
          ? await query`select * from fx_bento_market_snapshot where chain_id = ${options.chainId} order by timestamp desc limit ${limit}`
          : options.poolId
            ? await query`select * from fx_bento_market_snapshot where lower(pool_id) = lower(${options.poolId}) order by timestamp desc limit ${limit}`
            : await query`select * from fx_bento_market_snapshot order by timestamp desc limit ${limit}`;
      return rows.map(normalizeSqlSnapshot);
    },

    async health() {
      try {
        const [checkpoints, events] = await Promise.all([
          query`select latest_checkpoint from _ponder_checkpoint order by chain_id asc limit 1`,
          query`select block_number, timestamp from fx_bento_event order by block_number desc limit 1`,
        ]);
        const checkpoint = decodePonderCheckpoint(stringOrNull(checkpoints[0]?.latest_checkpoint));
        const latestEvent = events[0];
        const latestEventTimestamp = latestEvent ? timestampFromSeconds(latestEvent.timestamp) : null;
        if (checkpoint) {
          const latestTimestamp = timestampFromSeconds(checkpoint.blockTimestamp);
          return {
            status: "sql",
            ok: true,
            source: "checkpoint",
            latestBlockNumber: checkpoint.blockNumber,
            latestTimestamp,
            lagSeconds: latestTimestamp
              ? Math.max(0, Math.floor((Date.now() - Date.parse(latestTimestamp)) / 1000))
              : null,
            latestEventBlockNumber: latestEvent ? stringOrNull(latestEvent.block_number) : null,
            latestEventTimestamp,
          };
        }
        return {
          status: "sql",
          ok: events.length > 0,
          source: "event",
          latestBlockNumber: latestEvent ? stringOrNull(latestEvent.block_number) : null,
          latestTimestamp: latestEventTimestamp,
          lagSeconds: latestEventTimestamp
            ? Math.max(0, Math.floor((Date.now() - Date.parse(latestEventTimestamp)) / 1000))
            : null,
          latestEventBlockNumber: latestEvent ? stringOrNull(latestEvent.block_number) : null,
          latestEventTimestamp,
        };
      } catch (error) {
        return {
          status: "sql",
          ok: false,
          error: error instanceof Error ? error.message : "unknown_error",
        };
      }
    },
  };
}

export function createPonderGraphqlReadSource(args: { endpoint: string; fetcher?: PonderFetch }): PonderReadSource {
  const fetcher = args.fetcher ?? fetch;
  const endpoint = args.endpoint.replace(/\/$/, "");

  async function query<T>(queryText: string): Promise<T> {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: queryText }),
    });
    if (!response.ok) throw new Error(`ponder_graphql_http_${response.status}`);
    const body = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
    if (body.errors?.length) {
      throw new Error(`ponder_graphql_error:${body.errors.map((error) => error.message ?? "unknown").join(";")}`);
    }
    if (!body.data) throw new Error("ponder_graphql_empty_data");
    return body.data;
  }

  return {
    async listFxBentoRooms(chainId) {
      const where = chainId ? `(where: { chainId: ${chainId} }, limit: 250)` : "(limit: 250)";
      const data = await query<Record<string, unknown>>(`
        query FxBentoRooms {
          fxBentoRooms${where} {
            items {
              id chainId roomId poolId entryToken entryFee marketId status playerCount
              escrowedAmount protocolFee settlementRoot resultsMetadataUri
              resultsChallenged resultsFinalized createdAt updatedAt
            }
          }
        }
      `);
      return collection(data, ["fxBentoRooms", "fx_bento_rooms"]).map((room) => normalizePonderRoom(room));
    },

    async inspectFxBentoRoom({ chainId, roomId }) {
      const safeRoomId = JSON.stringify(roomId);
      const chainFilter = chainId ? `chainId: ${chainId}, ` : "";
      const data = await query<Record<string, unknown>>(`
        query FxBentoRoomDetail {
          fxBentoRooms(where: { ${chainFilter}roomId: ${safeRoomId} }, limit: 1) {
            items {
              id chainId roomId poolId entryToken entryFee marketId status playerCount
              escrowedAmount protocolFee settlementRoot resultsMetadataUri
              resultsChallenged resultsFinalized createdAt updatedAt
            }
          }
          fxBentoRoomPlayers(where: { ${chainFilter}roomId: ${safeRoomId} }, limit: 250) {
            items { player status joinedAt leftAt refundedAt prizeClaimedAmount updatedAt }
          }
          fxBentoRounds(where: { ${chainFilter}roomId: ${safeRoomId} }, limit: 250) {
            items { roomId roundIndex status startTime lockTime endTime anchorPrice settlementPrice updatedAt }
          }
          fxBentoCommitments(where: { ${chainFilter}roomId: ${safeRoomId} }, limit: 500) {
            items { roomId roundIndex player commitment selectedTilesHash committedTxHash revealedTxHash updatedAt }
          }
        }
      `);
      const room = collection(data, ["fxBentoRooms", "fx_bento_rooms"])[0];
      if (!room) return null;
      const players = collection(data, ["fxBentoRoomPlayers", "fx_bento_room_players"]);
      const rounds = collection(data, ["fxBentoRounds", "fx_bento_rounds"]);
      const commitments = collection(data, ["fxBentoCommitments", "fx_bento_commitments"]);
      return normalizePonderRoom(room, players, rounds, commitments);
    },

    async inspectFxBentoMarketSnapshots(options = {}) {
      const limit = options.limit ?? 50;
      const filters = [
        options.chainId ? `chainId: ${options.chainId}` : null,
        options.poolId ? `poolId: ${JSON.stringify(options.poolId)}` : null,
      ].filter(Boolean);
      const where = filters.length > 0 ? `where: { ${filters.join(", ")} }, ` : "";
      const data = await query<Record<string, unknown>>(`
        query FxBentoMarketSnapshots {
          fxBentoMarketSnapshots(${where}limit: ${limit}) {
            items { id chainId poolId sqrtPriceX96 tick timestamp volatility txHash }
          }
        }
      `);
      return collection(data, ["fxBentoMarketSnapshots", "fx_bento_market_snapshots"]).map(normalizePonderSnapshot);
    },

    async health() {
      try {
        const data = await query<Record<string, unknown>>(`
          query PonderHealth {
            fxBentoEvents(orderBy: "blockNumber", orderDirection: "desc", limit: 1) {
              items { blockNumber timestamp }
            }
          }
        `);
        const latest = collection(data, ["fxBentoEvents", "fx_bento_events"])[0];
        const latestTimestamp = latest ? timestampFromSeconds(latest.timestamp) : null;
        return {
          status: "remote",
          endpoint,
          ok: true,
          latestBlockNumber: latest ? stringOrNull(latest.blockNumber) : null,
          latestTimestamp,
          lagSeconds: latestTimestamp
            ? Math.max(0, Math.floor((Date.now() - Date.parse(latestTimestamp)) / 1000))
            : null,
        };
      } catch (error) {
        return {
          status: "remote",
          endpoint,
          ok: false,
          error: error instanceof Error ? error.message : "unknown_error",
        };
      }
    },
  };
}

export function resetPonderStateForTests(): void {
  indexedEvents.length = 0;
  rooms.clear();
  marketSnapshots.clear();
}

function applyFxBentoReadModel(event: IndexedEvent, contractName: ContractName): void {
  if (event.roomId) applyRoomEvent(event);
  if (contractName === "FXBentoHook" && event.kind === "fxBento.marketSnapshot") {
    const snapshot = {
      id: event.id,
      chainId: event.chainId,
      poolId: event.poolId ?? String(event.payload.poolId ?? ""),
      sqrtPriceX96: stringPayload(event.payload.sqrtPriceX96),
      tick: stringPayload(event.payload.tick),
      timestamp: timestampFromSeconds(event.payload.timestamp) ?? event.timestamp,
      volatility: stringPayload(event.payload.volatility),
      txHash: event.txHash,
    };
    if (snapshot.poolId) marketSnapshots.set(snapshot.id, snapshot);
  }
}

function applyRoomEvent(event: IndexedEvent): void {
  const roomId = event.roomId;
  if (!roomId) return;
  const room = ensureRoom(event.chainId, roomId);
  room.updatedAt = event.timestamp;

  switch (event.kind) {
    case "fxBento.roomCreated":
      room.poolId = stringOrNull(event.payload.poolId);
      room.entryToken = stringOrNull(event.payload.entryToken);
      room.entryFee = stringOrNull(event.payload.entryFee);
      room.status = "lobby";
      break;
    case "fxBento.roomStatusUpdated":
      room.status = roomStatusFromPayload(event.payload.status);
      break;
    case "fxBento.playerJoined":
      if (event.wallet) upsertPlayer(room, event.wallet, { status: "joined", joinedAt: event.timestamp });
      room.playerCount = room.players.filter((player) => player.status === "joined").length;
      break;
    case "fxBento.playerLeft":
      if (event.wallet) upsertPlayer(room, event.wallet, { status: "left", leftAt: event.timestamp });
      room.playerCount = room.players.filter((player) => player.status === "joined").length;
      break;
    case "fxBento.refundClaimed":
      if (event.wallet) upsertPlayer(room, event.wallet, { status: "refunded", refundedAt: event.timestamp });
      room.playerCount = room.players.filter((player) => player.status === "joined").length;
      break;
    case "fxBento.roomCancelled":
      room.status = "cancelled";
      break;
    case "fxBento.roomLocked":
      room.status = "active";
      room.escrowedAmount = stringOrNull(event.payload.escrowed);
      break;
    case "fxBento.roomSettled":
      room.status = "settled";
      room.settlementRoot = stringOrNull(event.payload.resultsRoot);
      room.protocolFee = stringOrNull(event.payload.protocolFee);
      room.results.root = room.settlementRoot;
      break;
    case "fxBento.prizeClaimed":
      if (event.wallet) {
        upsertPlayer(room, event.wallet, {
          prizeClaimedAmount: stringOrNull(event.payload.amount),
        });
      }
      break;
    case "fxBento.roundStarted":
      upsertRound(room, event.roundIndex ?? 0, {
        status: "active",
        startTime: timestampFromSeconds(event.payload.startTime),
        lockTime: timestampFromSeconds(event.payload.lockTime),
        endTime: timestampFromSeconds(event.payload.endTime),
      });
      break;
    case "fxBento.anchorRecorded":
      upsertRound(room, event.roundIndex ?? 0, { anchorPrice: stringOrNull(event.payload.price) });
      break;
    case "fxBento.settlementRecorded":
    case "fxBento.roundSettled":
      upsertRound(room, event.roundIndex ?? 0, {
        status: "settled",
        settlementPrice: stringOrNull(event.payload.price),
      });
      break;
    case "fxBento.commitmentSubmitted":
      if (event.wallet) {
        const round = upsertRound(room, event.roundIndex ?? 0, {});
        const existing = round.commitments.findIndex((item) => item.wallet.toLowerCase() === event.wallet?.toLowerCase());
        const commitment = {
          wallet: event.wallet,
          commitment: String(event.payload.commitment ?? ""),
          txHash: event.txHash,
        };
        if (existing >= 0) round.commitments[existing] = commitment;
        else round.commitments.push(commitment);
      }
      break;
    case "fxBento.selectionRevealed":
      if (event.wallet) {
        const round = upsertRound(room, event.roundIndex ?? 0, {});
        const existing = round.reveals.findIndex((item) => item.wallet.toLowerCase() === event.wallet?.toLowerCase());
        const reveal = {
          wallet: event.wallet,
          selectedTilesHash: String(event.payload.selectedTilesHash ?? ""),
          txHash: event.txHash,
        };
        if (existing >= 0) round.reveals[existing] = reveal;
        else round.reveals.push(reveal);
      }
      break;
    case "fxBento.resultsSubmitted":
      room.status = "settling";
      room.results.root = stringOrNull(event.payload.resultsRoot);
      room.results.metadataURI = stringOrNull(event.payload.metadataURI);
      room.results.submittedAt = event.timestamp;
      break;
    case "fxBento.resultsChallenged":
      room.results.challenged = true;
      break;
    case "fxBento.challengeResolved":
      room.results.challenged = false;
      break;
    case "fxBento.resultsFinalized":
      room.results.finalized = true;
      room.results.finalizedAt = event.timestamp;
      break;
    case "fxBento.settlementRescued":
      room.status = "cancelled";
      break;
  }
}

function ensureRoom(chainId: number, roomId: string): FxBentoRoomReadModel {
  const key = roomKey(chainId, roomId);
  const existing = rooms.get(key);
  if (existing) return existing;
  const room: FxBentoRoomReadModel = {
    id: key,
    chainId,
    roomId,
    poolId: null,
    entryToken: null,
    entryFee: null,
    marketId: null,
    status: "unknown",
    playerCount: 0,
    players: [],
    escrowedAmount: null,
    protocolFee: null,
    settlementRoot: null,
    results: {
      root: null,
      metadataURI: null,
      challenged: false,
      finalized: false,
      submittedAt: null,
      finalizedAt: null,
    },
    rounds: [],
    updatedAt: nowIso(),
  };
  rooms.set(key, room);
  return room;
}

function upsertPlayer(
  room: FxBentoRoomReadModel,
  wallet: string,
  patch: Partial<FxBentoRoomReadModel["players"][number]>
): void {
  const index = room.players.findIndex((player) => player.wallet.toLowerCase() === wallet.toLowerCase());
  const current =
    index >= 0
      ? room.players[index]
      : {
          wallet,
          status: "joined" as const,
          joinedAt: null,
          leftAt: null,
          refundedAt: null,
          prizeClaimedAmount: null,
        };
  const next = { ...current, ...patch, wallet };
  if (index >= 0) room.players[index] = next;
  else room.players.push(next);
}

function upsertRound(
  room: FxBentoRoomReadModel,
  roundIndex: number,
  patch: Partial<FxBentoRoundReadModel>
): FxBentoRoundReadModel {
  const index = room.rounds.findIndex((round) => round.roundIndex === roundIndex);
  const current =
    index >= 0
      ? room.rounds[index]
      : {
          roomId: room.roomId,
          roundIndex,
          status: "active" as const,
          startTime: null,
          lockTime: null,
          endTime: null,
          anchorPrice: null,
          settlementPrice: null,
          commitments: [],
          reveals: [],
        };
  const next = { ...current, ...patch };
  if (index >= 0) room.rounds[index] = next;
  else room.rounds.push(next);
  room.rounds.sort((a, b) => a.roundIndex - b.roundIndex);
  return next;
}

function roomKey(chainId: number, roomId: string): string {
  return `${chainId}:${roomId}`;
}

function normalizePayload(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, normalizeValue(value)]));
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]));
  }
  return value;
}

function stringifyArg(value: unknown): string | undefined {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "string") return String(value);
  return undefined;
}

function numberArg(value: unknown): number | undefined {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function addressArg(value: unknown): `0x${string}` | undefined {
  const parsed = AddressSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function hexArg(value: unknown): `0x${string}` | undefined {
  const parsed = HexSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint" || typeof value === "number") return timestampFromSeconds(value) ?? nowIso();
  return nowIso();
}

function timestampFromSeconds(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return new Date(Number(value) * 1000).toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof value === "bigint") return new Date(Number(value) * 1000).toISOString();
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  return null;
}

function roomStatusFromPayload(value: unknown): FxBentoRoomReadModel["status"] {
  const id = numberArg(value);
  if (id !== undefined && id in ROOM_STATUS_BY_ID) return ROOM_STATUS_BY_ID[id as keyof typeof ROOM_STATUS_BY_ID];
  return "unknown";
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function decodePonderCheckpoint(checkpoint: string | null): { blockTimestamp: string; blockNumber: string } | null {
  if (!checkpoint || checkpoint.length < 42 || !/^\d+$/.test(checkpoint)) return null;
  return {
    blockTimestamp: BigInt(checkpoint.slice(0, 10)).toString(),
    blockNumber: BigInt(checkpoint.slice(26, 42)).toString(),
  };
}

function stringPayload(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function collection(data: Record<string, unknown>, keys: string[]): Array<Record<string, unknown>> {
  for (const key of keys) {
    const value = data[key];
    if (value && typeof value === "object" && "items" in value) {
      const items = (value as { items?: unknown }).items;
      return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
    }
  }
  return [];
}

function normalizeSqlRoom(
  room: Record<string, unknown>,
  players: Array<Record<string, unknown>> = [],
  rounds: Array<Record<string, unknown>> = [],
  commitments: Array<Record<string, unknown>> = []
): FxBentoRoomReadModel {
  return normalizePonderRoom(
    {
      id: room.id,
      chainId: room.chain_id,
      roomId: room.room_id,
      poolId: room.pool_id,
      entryToken: room.entry_token,
      entryFee: room.entry_fee,
      marketId: room.market_id,
      status: room.status,
      playerCount: room.player_count,
      escrowedAmount: room.escrowed_amount,
      protocolFee: room.protocol_fee,
      settlementRoot: room.settlement_root,
      resultsMetadataUri: room.results_metadata_uri,
      resultsChallenged: room.results_challenged,
      resultsFinalized: room.results_finalized,
      updatedAt: room.updated_at,
    },
    players.map((player) => ({
      player: player.player,
      status: player.status,
      joinedAt: player.joined_at,
      leftAt: player.left_at,
      refundedAt: player.refunded_at,
      prizeClaimedAmount: player.prize_claimed_amount,
      updatedAt: player.updated_at,
    })),
    rounds.map((round) => ({
      roomId: round.room_id,
      roundIndex: round.round_index,
      status: round.status,
      startTime: round.start_time,
      lockTime: round.lock_time,
      endTime: round.end_time,
      anchorPrice: round.anchor_price,
      settlementPrice: round.settlement_price,
      updatedAt: round.updated_at,
    })),
    commitments.map((commitment) => ({
      roomId: commitment.room_id,
      roundIndex: commitment.round_index,
      player: commitment.player,
      commitment: commitment.commitment,
      selectedTilesHash: commitment.selected_tiles_hash,
      committedTxHash: commitment.committed_tx_hash,
      revealedTxHash: commitment.revealed_tx_hash,
      updatedAt: commitment.updated_at,
    }))
  );
}

function normalizePonderRoom(
  room: Record<string, unknown>,
  players: Array<Record<string, unknown>> = [],
  rounds: Array<Record<string, unknown>> = [],
  commitments: Array<Record<string, unknown>> = []
): FxBentoRoomReadModel {
  const normalizedRounds = rounds.map(normalizePonderRound);
  for (const commitment of commitments) {
    const round = ensureNormalizedRound(normalizedRounds, Number(commitment.roundIndex ?? 0), String(room.roomId ?? ""));
    const wallet = String(commitment.player ?? "");
    if (!wallet) continue;
    const commitmentHash = String(commitment.commitment ?? "");
    if (commitmentHash) {
      round.commitments.push({
        wallet,
        commitment: commitmentHash,
        txHash: String(commitment.committedTxHash ?? ""),
      });
    }
    const selectedTilesHash = String(commitment.selectedTilesHash ?? "");
    if (selectedTilesHash) {
      round.reveals.push({
        wallet,
        selectedTilesHash,
        txHash: String(commitment.revealedTxHash ?? ""),
      });
    }
  }
  normalizedRounds.sort((left, right) => left.roundIndex - right.roundIndex);

  return {
    id: String(room.id ?? `${room.chainId}:${room.roomId}`),
    chainId: Number(room.chainId ?? 0),
    roomId: String(room.roomId ?? ""),
    poolId: stringOrNull(room.poolId),
    entryToken: stringOrNull(room.entryToken),
    entryFee: stringOrNull(room.entryFee),
    marketId: stringOrNull(room.marketId),
    status: normalizeRoomStatus(room.status),
    playerCount: Math.max(
      Number(room.playerCount ?? 0),
      players.filter((player) => normalizePlayerStatus(player.status) === "joined").length
    ),
    players: players.map((player) => ({
      wallet: String(player.player ?? player.wallet ?? ""),
      status: normalizePlayerStatus(player.status),
      joinedAt: timestampFromSeconds(player.joinedAt),
      leftAt: timestampFromSeconds(player.leftAt),
      refundedAt: timestampFromSeconds(player.refundedAt),
      prizeClaimedAmount: stringOrNull(player.prizeClaimedAmount),
    })),
    escrowedAmount: stringOrNull(room.escrowedAmount),
    protocolFee: stringOrNull(room.protocolFee),
    settlementRoot: stringOrNull(room.settlementRoot),
    results: {
      root: stringOrNull(room.settlementRoot),
      metadataURI: stringOrNull(room.resultsMetadataUri),
      challenged: Boolean(room.resultsChallenged),
      finalized: Boolean(room.resultsFinalized),
      submittedAt: null,
      finalizedAt: Boolean(room.resultsFinalized) ? timestampFromSeconds(room.updatedAt) : null,
    },
    rounds: normalizedRounds,
    updatedAt: timestampFromSeconds(room.updatedAt) ?? nowIso(),
  };
}

function normalizePonderRound(round: Record<string, unknown>): FxBentoRoundReadModel {
  return {
    roomId: String(round.roomId ?? ""),
    roundIndex: Number(round.roundIndex ?? 0),
    status: round.status === "settled" ? "settled" : "active",
    startTime: timestampFromSeconds(round.startTime),
    lockTime: timestampFromSeconds(round.lockTime),
    endTime: timestampFromSeconds(round.endTime),
    anchorPrice: stringOrNull(round.anchorPrice),
    settlementPrice: stringOrNull(round.settlementPrice),
    commitments: [],
    reveals: [],
  };
}

function normalizePonderSnapshot(snapshot: Record<string, unknown>): FxBentoMarketSnapshotReadModel {
  return {
    id: String(snapshot.id ?? ""),
    chainId: Number(snapshot.chainId ?? 0),
    poolId: String(snapshot.poolId ?? ""),
    sqrtPriceX96: String(snapshot.sqrtPriceX96 ?? "0"),
    tick: String(snapshot.tick ?? "0"),
    timestamp: timestampFromSeconds(snapshot.timestamp) ?? nowIso(),
    volatility: String(snapshot.volatility ?? "0"),
    txHash: String(snapshot.txHash ?? ""),
  };
}

function normalizeSqlSnapshot(snapshot: Record<string, unknown>): FxBentoMarketSnapshotReadModel {
  return normalizePonderSnapshot({
    id: snapshot.id,
    chainId: snapshot.chain_id,
    poolId: snapshot.pool_id,
    sqrtPriceX96: snapshot.sqrt_price_x96,
    tick: snapshot.tick,
    timestamp: snapshot.timestamp,
    volatility: snapshot.volatility,
    txHash: snapshot.tx_hash,
  });
}

function ensureNormalizedRound(rounds: FxBentoRoundReadModel[], roundIndex: number, roomId: string): FxBentoRoundReadModel {
  const existing = rounds.find((round) => round.roundIndex === roundIndex);
  if (existing) return existing;
  const round: FxBentoRoundReadModel = {
    roomId,
    roundIndex,
    status: "active",
    startTime: null,
    lockTime: null,
    endTime: null,
    anchorPrice: null,
    settlementPrice: null,
    commitments: [],
    reveals: [],
  };
  rounds.push(round);
  return round;
}

function normalizeRoomStatus(value: unknown): FxBentoRoomReadModel["status"] {
  const status = String(value ?? "unknown");
  return FxBentoRoomReadModelStatusSet.has(status) ? (status as FxBentoRoomReadModel["status"]) : "unknown";
}

function normalizePlayerStatus(value: unknown): FxBentoRoomReadModel["players"][number]["status"] {
  const status = String(value ?? "joined");
  return status === "left" || status === "refunded" ? status : "joined";
}

function sqlRows(rows: unknown): Array<Record<string, unknown>> {
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function isMissingPonderTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : "message" in error ? String((error as { message?: unknown }).message) : "";
  return code === "42P01" || message.includes("does not exist");
}

const FxBentoRoomReadModelStatusSet = new Set(["lobby", "active", "settling", "settled", "cancelled", "unknown"]);
