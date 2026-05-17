import { Liveblocks } from "@liveblocks/node";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  parseAbi,
  recoverAddress,
  type Address,
  type Hex,
  type Log
} from "viem";
import {
  ROOM_STATUS,
  roomFlowActions,
  selectedTilesHash,
  tileCommitmentDigest,
  validateAntiWall,
  type RoomStatus,
  type TileSelection
} from "../../sdk/src/index";

type RoomRecord = {
  id: string;
  contractRoomId?: string;
  market: string;
  entryFee: string;
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  roundDuration: number;
  startTime: number;
  status: RoomStatus;
  joinIntents: Address[];
  activePlayers: Address[];
  spectators: Address[];
  commitments: Map<string, CommitmentRecord>;
  reveals: Map<string, RevealRecord>;
  leaderboard: Array<{ player: Address; score: number }>;
  resultsRoot?: Hex;
  challengeOpen?: boolean;
  settlementRescueDeadline?: number;
};

type CommitmentRecord = {
  player: Address;
  roundIndex: number;
  commitment: Hex;
  signature?: Hex;
  relayedTx?: Hex;
};

type RevealRecord = {
  player: Address;
  roundIndex: number;
  selection: TileSelection;
  selectionHash: Hex;
  nonce: Hex;
  relayedTx?: Hex;
};

type IndexedEvent =
  | {
      type: "RoomCreated";
      roomId: string;
      localRoomId?: string;
      market?: string;
      entryFee?: string;
      minPlayers?: number;
      maxPlayers?: number;
      rounds?: number;
      roundDuration?: number;
      startTime?: number;
      txHash?: Hex;
      logIndex?: number;
    }
  | { type: "RoomJoined" | "RoomLeft" | "Refunded"; roomId: string; player: Address; txHash?: Hex; logIndex?: number }
  | { type: "RoomLocked" | "RoomCancelled"; roomId: string; txHash?: Hex; logIndex?: number }
  | {
      type: "RoomSettled";
      roomId: string;
      resultsRoot: Hex;
      leaderboard?: Array<{ player: Address; score: number }>;
      txHash?: Hex;
      logIndex?: number;
    }
  | { type: "ResultsSubmitted"; roomId: string; resultsRoot: Hex; txHash?: Hex; logIndex?: number }
  | { type: "ResultsChallenged"; roomId: string; txHash?: Hex; logIndex?: number }
  | { type: "ChallengeResolved"; roomId: string; accepted: boolean; txHash?: Hex; logIndex?: number }
  | { type: "SettlementRescued"; roomId: string; txHash?: Hex; logIndex?: number };

type ChainPollerConfig = {
  rpcUrl: string;
  chainId: number;
  pollIntervalMs: number;
  fromBlock: bigint;
  factoryAddress?: Address;
  escrowAddress?: Address;
  settlementAddress?: Address;
};

type PersistedState = {
  rooms?: Array<Omit<RoomRecord, "commitments" | "reveals"> & {
    commitments?: Array<[string, CommitmentRecord]>;
    reveals?: Array<[string, RevealRecord]>;
  }>;
  roomIdByContractId?: Array<[string, string]>;
  processedEvents?: string[];
  relayIdempotency?: Array<[string, string]>;
  pollerCursorBlock?: string;
};

const app = new Hono();
const liveblocksSecret = process.env.LIVEBLOCKS_SECRET_KEY;
const liveblocks = liveblocksSecret ? new Liveblocks({ secret: liveblocksSecret }) : null;
const rooms = new Map<string, RoomRecord>();
const roomIdByContractId = new Map<string, string>();
const processedEvents = new Set<string>();
const relayIdempotency = new Map<string, string>();
const statePath = resolve(process.env.FX_BENTO_STATE_PATH ?? ".fx-bento/backend-state.json");
let pollerCursorBlock: bigint | null = null;
let pollerBusy = false;

const fxBentoEventAbi = parseAbi([
  "event RoomCreated(uint256 indexed roomId, bytes32 indexed poolId, address indexed entryToken, uint256 entryFee)",
  "event RoomJoined(uint256 indexed roomId, address indexed player)",
  "event RoomLeft(uint256 indexed roomId, address indexed player)",
  "event RoomCancelled(uint256 indexed roomId)",
  "event RoomLocked(uint256 indexed roomId, uint256 escrowed)",
  "event RoomSettled(uint256 indexed roomId, bytes32 indexed resultsRoot, bytes32 indexed payoutSchemaHash, uint256 payoutTotal, uint256 protocolFee)",
  "event Refunded(uint256 indexed roomId, address indexed player, uint256 amount)",
  "event ResultsSubmitted(uint256 indexed roomId, bytes32 indexed resultsRoot, string metadataURI)",
  "event ResultsChallenged(uint256 indexed roomId, bytes proof)",
  "event ChallengeResolved(uint256 indexed roomId, bool accepted)",
  "event SettlementRescued(uint256 indexed roomId)"
]);

loadState();
startChainLogPollerFromEnv();

app.use("*", cors());

app.post("/arcade/rooms", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = crypto.randomUUID();
  const room: RoomRecord = {
    id,
    contractRoomId: typeof body.contractRoomId === "string" ? body.contractRoomId : undefined,
    market: typeof body.market === "string" ? body.market : "USDC/EURC",
    entryFee: typeof body.entryFee === "string" ? body.entryFee : "5 USDC",
    minPlayers: readNumber(body.minPlayers, 2),
    maxPlayers: readNumber(body.maxPlayers, 20),
    rounds: readNumber(body.rounds, 10),
    roundDuration: readNumber(body.roundDuration, 60),
    startTime: readNumber(body.startTime, Math.floor(Date.now() / 1000) + 60),
    status: ROOM_STATUS.Lobby,
    joinIntents: [],
    activePlayers: [],
    spectators: [],
    commitments: new Map(),
    reveals: new Map(),
    leaderboard: []
  };
  if (room.minPlayers < 2 || room.minPlayers > room.maxPlayers) {
    return c.json({ error: "invalid player limits" }, 400);
  }
  rooms.set(id, room);
  if (room.contractRoomId) roomIdByContractId.set(room.contractRoomId, id);
  saveState();
  return c.json(toPublicRoom(room), 201);
});

app.get("/arcade/rooms", (c) => c.json([...rooms.values()].map((room) => toPublicRoom(syncRoomStatus(room)))));

app.get("/arcade/rooms/:id", (c) => {
  const room = getRoom(c.req.param("id"));
  return room ? c.json(toPublicRoom(syncRoomStatus(room))) : c.json({ error: "room not found" }, 404);
});

app.post("/arcade/rooms/:id/join-intent", async (c) => {
  const room = getRoom(c.req.param("id"));
  if (!room) return c.json({ error: "room not found" }, 404);
  syncRoomStatus(room);
  const body = await c.req.json().catch(() => ({}));
  const player = normalizeAddress(body.player);
  if (!player) return c.json({ error: "valid player required" }, 400);
  if (room.status !== ROOM_STATUS.Lobby) return c.json({ error: "room is not joinable" }, 409);
  if (room.activePlayers.length >= room.maxPlayers) return c.json({ error: "room full" }, 409);
  addUnique(room.joinIntents, player);

  if (body.mockConfirmed === true) {
    addUnique(room.activePlayers, player);
  }

  saveState();
  return c.json({
    roomId: room.id,
    player,
    active: room.activePlayers.includes(player),
    message: "Submit entry fee onchain; backend is not custody."
  });
});

app.post("/arcade/rooms/:id/commit", async (c) => {
  const room = getRoom(c.req.param("id"));
  if (!room) return c.json({ error: "room not found" }, 404);
  syncRoomStatus(room);
  const body = await c.req.json().catch(() => ({}));
  const player = normalizeAddress(body.player);
  const commitment = normalizeHex(body.commitment);
  const roundIndex = readNumber(body.roundIndex, 0);
  if (!player || !commitment) return c.json({ error: "player and commitment required" }, 400);
  if (!canUseRoom(room, player)) return c.json({ error: "player is not active in this room" }, 403);
  if (!roomFlowActions(toLifecycleView(room), BigInt(nowSeconds())).canCommitOrReveal) {
    return c.json({ error: "room is not accepting commitments" }, 409);
  }

  const signature = normalizeHex(body.signature);
  if (signature) {
    const verification = await verifyCommitmentSignature(body, player, commitment, roundIndex);
    if (!verification.ok) return c.json({ error: verification.error }, 400);
  }

  const idempotency = readIdempotencyKey(body.idempotencyKey);
  const idempotencyKey = idempotency ? `commit:${room.id}:${idempotency}` : null;
  if (idempotencyKey) {
    const seenValue = relayIdempotency.get(idempotencyKey);
    if (seenValue && seenValue !== commitment) return c.json({ error: "idempotency key conflict" }, 409);
    if (seenValue === commitment) return c.json({ roomId: room.id, accepted: true, idempotent: true, commitment });
  }

  const key = commitmentKey(roundIndex, player);
  const existing = room.commitments.get(key);
  if (existing && existing.commitment !== commitment) {
    return c.json({ error: "different commitment already recorded" }, 409);
  }
  const record: CommitmentRecord = {
    player,
    roundIndex,
    commitment,
    signature: signature ?? undefined,
    relayedTx: normalizeHex(body.relayedTx) ?? undefined
  };
  room.commitments.set(key, existing ?? record);
  if (idempotencyKey) relayIdempotency.set(idempotencyKey, commitment);
  saveState();
  return c.json({ roomId: room.id, accepted: true, idempotent: Boolean(existing), commitment });
});

app.post("/arcade/rooms/:id/reveal", async (c) => {
  const room = getRoom(c.req.param("id"));
  if (!room) return c.json({ error: "room not found" }, 404);
  syncRoomStatus(room);
  const body = await c.req.json().catch(() => ({}));
  const player = normalizeAddress(body.player);
  const roundIndex = readNumber(body.roundIndex, 0);
  const nonce = normalizeHex(body.nonce);
  const selection = normalizeSelection(body.selection);
  if (!player || !nonce || !selection) return c.json({ error: "player, selection, and nonce required" }, 400);
  if (!canUseRoom(room, player)) return c.json({ error: "player is not active in this room" }, 403);
  if (!roomFlowActions(toLifecycleView(room), BigInt(nowSeconds())).canCommitOrReveal) {
    return c.json({ error: "room is not accepting reveals" }, 409);
  }
  const patternError = validateAntiWall(selection);
  if (patternError) return c.json({ error: patternError }, 400);
  const key = commitmentKey(roundIndex, player);
  if (!room.commitments.has(key)) return c.json({ error: "commitment not found" }, 409);
  const selectionHash = selectedTilesHash(selection);
  const idempotency = readIdempotencyKey(body.idempotencyKey);
  const idempotencyKey = idempotency ? `reveal:${room.id}:${idempotency}` : null;
  if (idempotencyKey) {
    const seenValue = relayIdempotency.get(idempotencyKey);
    if (seenValue && seenValue !== selectionHash) return c.json({ error: "idempotency key conflict" }, 409);
    if (seenValue === selectionHash) return c.json({ roomId: room.id, accepted: true, idempotent: true, selectionHash });
  }
  const existing = room.reveals.get(key);
  if (existing && existing.selectionHash !== selectionHash) {
    return c.json({ error: "different reveal already recorded" }, 409);
  }
  const record: RevealRecord = {
    player,
    roundIndex,
    selection,
    selectionHash,
    nonce,
    relayedTx: normalizeHex(body.relayedTx) ?? undefined
  };
  room.reveals.set(key, existing ?? record);
  if (idempotencyKey) relayIdempotency.set(idempotencyKey, selectionHash);
  saveState();
  return c.json({ roomId: room.id, accepted: true, idempotent: Boolean(existing), selectionHash });
});

app.get("/arcade/rooms/:id/leaderboard", (c) => {
  const room = getRoom(c.req.param("id"));
  return room ? c.json(room.leaderboard) : c.json({ error: "room not found" }, 404);
});

app.post("/arcade/rooms/:id/settle", async (c) => {
  const room = getRoom(c.req.param("id"));
  if (!room) return c.json({ error: "room not found" }, 404);
  syncRoomStatus(room);
  if (room.status !== ROOM_STATUS.Locked && room.status !== ROOM_STATUS.Settling) {
    return c.json({ error: "room is not settleable" }, 409);
  }
  const body = await c.req.json().catch(() => ({}));
  const resultsRoot = normalizeHex(body.resultsRoot);
  if (!resultsRoot) return c.json({ error: "resultsRoot required" }, 400);
  room.status = ROOM_STATUS.Settling;
  room.resultsRoot = resultsRoot;
  room.challengeOpen = body.challengeOpen === true;
  room.settlementRescueDeadline = readNumber(body.settlementRescueDeadline, nowSeconds() + 86_400);
  if (Array.isArray(body.leaderboard)) {
    room.leaderboard = body.leaderboard.flatMap((entry: unknown) => normalizeLeaderboardEntry(entry));
  }
  saveState();
  return c.json(toPublicRoom(room));
});

app.post("/arcade/events", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const candidates = Array.isArray(body.events) ? body.events : [body];
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const candidate of candidates) {
    const event = normalizeIndexedEvent(candidate);
    if (!event) {
      skipped.push("invalid");
      continue;
    }
    const eventId = indexedEventId(event);
    if (processedEvents.has(eventId)) {
      skipped.push(eventId);
      continue;
    }
    const ok = applyIndexedEvent(event);
    if (!ok) {
      skipped.push(eventId);
      continue;
    }
    processedEvents.add(eventId);
    applied.push(eventId);
  }

  if (applied.length > 0) saveState();
  return c.json({ applied, skipped, rooms: [...rooms.values()].map((room) => toPublicRoom(syncRoomStatus(room))) });
});

app.post("/arcade/indexer/poll", async (c) => {
  const poller = createChainLogPollerFromEnv();
  if (!poller) return c.json({ error: "chain log poller is not configured" }, 503);
  const result = await pollChainLogs(poller);
  return c.json(result);
});

app.post("/liveblocks/auth", async (c) => {
  if (!liveblocks) return c.json({ error: "LIVEBLOCKS_SECRET_KEY is not configured" }, 503);
  const body = await c.req.json().catch(() => ({}));
  const userId = normalizeAddress(body.userId);
  const room = getRoom(String(body.roomId ?? ""));
  if (!userId || !room) return c.json({ error: "valid userId and roomId required" }, 400);
  syncRoomStatus(room);
  const spectator = body.spectator === true;
  if (!spectator && !canUseRoom(room, userId)) return c.json({ error: "active room membership required" }, 403);
  if (room.status === ROOM_STATUS.Cancelled && !canUseRoom(room, userId)) {
    return c.json({ error: "room is cancelled" }, 409);
  }
  if (spectator) addUnique(room.spectators, userId);
  const session = liveblocks.prepareSession(userId, { userInfo: { name: userId } });
  session.allow(`fx-bento:${room.id}`, session.FULL_ACCESS);
  const { status, body: responseBody } = await session.authorize();
  return new Response(responseBody, { status });
});

function getRoom(id: string): RoomRecord | undefined {
  return rooms.get(id) ?? rooms.get(roomIdByContractId.get(id) ?? "");
}

function syncRoomStatus(room: RoomRecord): RoomRecord {
  if (room.status === ROOM_STATUS.Lobby && room.activePlayers.length >= room.minPlayers && nowSeconds() >= room.startTime) {
    room.status = ROOM_STATUS.Locked;
  }
  return room;
}

function toPublicRoom(room: RoomRecord) {
  return {
    id: room.id,
    contractRoomId: room.contractRoomId,
    market: room.market,
    entryFee: room.entryFee,
    minPlayers: room.minPlayers,
    maxPlayers: room.maxPlayers,
    rounds: room.rounds,
    roundDuration: room.roundDuration,
    startTime: room.startTime,
    status: room.status,
    statusLabel: statusLabel(room.status),
    joinIntents: room.joinIntents,
    activePlayers: room.activePlayers,
    spectators: room.spectators,
    commitments: room.commitments.size,
    reveals: room.reveals.size,
    leaderboard: room.leaderboard,
    resultsRoot: room.resultsRoot ?? null,
    challengeOpen: room.challengeOpen ?? false,
    settlementRescueDeadline: room.settlementRescueDeadline ?? null,
    actions: roomFlowActions(toLifecycleView(room), BigInt(nowSeconds()))
  };
}

function toLifecycleView(room: RoomRecord) {
  return {
    status: room.status,
    startTime: BigInt(room.startTime),
    minPlayers: room.minPlayers,
    activePlayers: room.activePlayers.length,
    rounds: room.rounds,
    roundDuration: room.roundDuration,
    resultsSubmitted: room.resultsRoot !== undefined,
    challengeOpen: room.challengeOpen,
    settlementRescueDeadline:
      room.settlementRescueDeadline === undefined ? undefined : BigInt(room.settlementRescueDeadline)
  };
}

function canUseRoom(room: RoomRecord, player: Address): boolean {
  return room.activePlayers.includes(player) && room.status !== ROOM_STATUS.Cancelled;
}

async function verifyCommitmentSignature(
  body: Record<string, unknown>,
  player: Address,
  commitment: Hex,
  roundIndex: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const signature = normalizeHex(body.signature);
  const verifyingContract = normalizeAddress(body.verifyingContract);
  if (!signature || !verifyingContract) return { ok: false, error: "signature and verifyingContract required" };
  const chainId = readBigInt(body.chainId);
  const roomId = readBigInt(body.contractRoomId ?? body.roomId);
  if (chainId === null || roomId === null) return { ok: false, error: "chainId and contractRoomId required" };
  const digest = tileCommitmentDigest({ chainId, verifyingContract, roomId, roundIndex, player, commitment });
  const recovered = await recoverAddress({ hash: digest, signature });
  return recovered.toLowerCase() === player.toLowerCase() ? { ok: true } : { ok: false, error: "bad commitment signature" };
}

function normalizeSelection(value: unknown): TileSelection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.rows) || !Array.isArray(candidate.cols)) return null;
  const clientStateHash = normalizeHex(candidate.clientStateHash);
  const chipCount = readNumber(candidate.chipCount, -1);
  if (!clientStateHash || chipCount < 0) return null;
  return {
    rows: candidate.rows.map((row) => readNumber(row, -1)),
    cols: candidate.cols.map((col) => readNumber(col, -1)),
    chipCount,
    clientStateHash
  };
}

function normalizeLeaderboardEntry(entry: unknown): Array<{ player: Address; score: number }> {
  if (!entry || typeof entry !== "object") return [];
  const candidate = entry as Record<string, unknown>;
  const player = normalizeAddress(candidate.player);
  const score = readNumber(candidate.score, Number.NaN);
  if (!player || Number.isNaN(score)) return [];
  return [{ player, score }];
}

function normalizeAddress(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value) ? (getAddress(value) as Address) : null;
}

function normalizeHex(value: unknown): Hex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) ? (value as Hex) : null;
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function addUnique(values: Address[], value: Address): void {
  if (!values.includes(value)) values.push(value);
}

function commitmentKey(roundIndex: number, player: Address): string {
  return `${roundIndex}:${player.toLowerCase()}`;
}

function statusLabel(status: RoomStatus): string {
  if (status === ROOM_STATUS.Lobby) return "lobby";
  if (status === ROOM_STATUS.Locked) return "locked";
  if (status === ROOM_STATUS.Settling) return "settling";
  if (status === ROOM_STATUS.Settled) return "settled";
  return "cancelled";
}

function normalizeIndexedEvent(value: unknown): IndexedEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const type = typeof event.type === "string" ? event.type : "";
  const roomId = typeof event.roomId === "string" ? event.roomId : null;
  if (!roomId) return null;
  const txHash = normalizeHex(event.txHash) ?? undefined;
  const logIndex = event.logIndex === undefined ? undefined : readNumber(event.logIndex, -1);
  const base = { roomId, txHash, logIndex: logIndex !== undefined && logIndex >= 0 ? logIndex : undefined };

  if (type === "RoomCreated") {
    return {
      type,
      ...base,
      localRoomId: typeof event.localRoomId === "string" ? event.localRoomId : undefined,
      market: typeof event.market === "string" ? event.market : undefined,
      entryFee: typeof event.entryFee === "string" ? event.entryFee : undefined,
      minPlayers: event.minPlayers === undefined ? undefined : readNumber(event.minPlayers, 2),
      maxPlayers: event.maxPlayers === undefined ? undefined : readNumber(event.maxPlayers, 20),
      rounds: event.rounds === undefined ? undefined : readNumber(event.rounds, 10),
      roundDuration: event.roundDuration === undefined ? undefined : readNumber(event.roundDuration, 60),
      startTime: event.startTime === undefined ? undefined : readNumber(event.startTime, nowSeconds() + 60)
    };
  }
  if (type === "RoomJoined" || type === "RoomLeft" || type === "Refunded") {
    const player = normalizeAddress(event.player);
    return player ? { type, ...base, player } : null;
  }
  if (type === "RoomLocked" || type === "RoomCancelled" || type === "SettlementRescued") return { type, ...base };
  if (type === "ResultsSubmitted" || type === "RoomSettled") {
    const resultsRoot = normalizeHex(event.resultsRoot);
    if (!resultsRoot) return null;
    return {
      type,
      ...base,
      resultsRoot,
      leaderboard: Array.isArray(event.leaderboard)
        ? event.leaderboard.flatMap((entry: unknown) => normalizeLeaderboardEntry(entry))
        : undefined
    };
  }
  if (type === "ResultsChallenged") return { type, ...base };
  if (type === "ChallengeResolved") return { type, ...base, accepted: event.accepted === true };
  return null;
}

function normalizeLogEvent(log: Log): IndexedEvent | null {
  try {
    const decoded = decodeEventLog({ abi: fxBentoEventAbi, data: log.data, topics: log.topics });
    const args = decoded.args as Record<string, unknown>;
    const roomId = readBigInt(args.roomId);
    if (roomId === null) return null;
    const base = {
      roomId: roomId.toString(),
      txHash: log.transactionHash ?? undefined,
      logIndex: log.logIndex ?? undefined
    };

    if (decoded.eventName === "RoomCreated") {
      return { type: "RoomCreated", ...base };
    }
    if (decoded.eventName === "RoomJoined") {
      const player = normalizeAddress(args.player);
      return player ? { type: "RoomJoined", ...base, player } : null;
    }
    if (decoded.eventName === "RoomLeft") {
      const player = normalizeAddress(args.player);
      return player ? { type: "RoomLeft", ...base, player } : null;
    }
    if (decoded.eventName === "Refunded") {
      const player = normalizeAddress(args.player);
      return player ? { type: "Refunded", ...base, player } : null;
    }
    if (decoded.eventName === "RoomLocked") {
      return { type: "RoomLocked", ...base };
    }
    if (decoded.eventName === "RoomCancelled") {
      return { type: "RoomCancelled", ...base };
    }
    if (decoded.eventName === "SettlementRescued") {
      return { type: "SettlementRescued", ...base };
    }
    if (decoded.eventName === "ResultsSubmitted") {
      const resultsRoot = normalizeHex(args.resultsRoot);
      return resultsRoot ? { type: "ResultsSubmitted", ...base, resultsRoot } : null;
    }
    if (decoded.eventName === "RoomSettled") {
      const resultsRoot = normalizeHex(args.resultsRoot);
      return resultsRoot ? { type: "RoomSettled", ...base, resultsRoot } : null;
    }
    if (decoded.eventName === "ResultsChallenged") return { type: "ResultsChallenged", ...base };
    if (decoded.eventName === "ChallengeResolved") return { type: "ChallengeResolved", ...base, accepted: args.accepted === true };
  } catch {
    return null;
  }
  return null;
}

function applyIndexedEvent(event: IndexedEvent): boolean {
  if (event.type === "RoomCreated") {
    const localId = event.localRoomId ?? roomIdByContractId.get(event.roomId) ?? `contract:${event.roomId}`;
    const existing = rooms.get(localId);
    const room: RoomRecord =
      existing ??
      ({
        id: localId,
        contractRoomId: event.roomId,
        market: event.market ?? "USDC/EURC",
        entryFee: event.entryFee ?? "5 USDC",
        minPlayers: event.minPlayers ?? 2,
        maxPlayers: event.maxPlayers ?? 20,
        rounds: event.rounds ?? 10,
        roundDuration: event.roundDuration ?? 60,
        startTime: event.startTime ?? nowSeconds() + 60,
        status: ROOM_STATUS.Lobby,
        joinIntents: [],
        activePlayers: [],
        spectators: [],
        commitments: new Map(),
        reveals: new Map(),
        leaderboard: []
      } satisfies RoomRecord);
    room.contractRoomId = event.roomId;
    rooms.set(localId, room);
    roomIdByContractId.set(event.roomId, localId);
    return true;
  }

  const room = getRoom(event.roomId);
  if (!room) return false;
  if (event.type === "RoomJoined") {
    addUnique(room.activePlayers, event.player);
    addUnique(room.joinIntents, event.player);
    return true;
  }
  if (event.type === "RoomLeft" || event.type === "Refunded") {
    removeValue(room.activePlayers, event.player);
    return true;
  }
  if (event.type === "RoomLocked") {
    room.status = ROOM_STATUS.Locked;
    return true;
  }
  if (event.type === "ResultsSubmitted") {
    room.status = ROOM_STATUS.Settling;
    room.resultsRoot = event.resultsRoot;
    room.challengeOpen = false;
    return true;
  }
  if (event.type === "ResultsChallenged") {
    room.status = ROOM_STATUS.Settling;
    room.challengeOpen = true;
    return true;
  }
  if (event.type === "ChallengeResolved") {
    room.challengeOpen = false;
    return true;
  }
  if (event.type === "RoomSettled") {
    room.status = ROOM_STATUS.Settled;
    room.resultsRoot = event.resultsRoot;
    room.challengeOpen = false;
    if (event.leaderboard) room.leaderboard = event.leaderboard;
    return true;
  }
  if (event.type === "RoomCancelled" || event.type === "SettlementRescued") {
    room.status = ROOM_STATUS.Cancelled;
    room.challengeOpen = false;
    return true;
  }
  return false;
}

function indexedEventId(event: IndexedEvent): string {
  if (event.txHash && event.logIndex !== undefined) return `${event.txHash}:${event.logIndex}`;
  return `${event.type}:${event.roomId}:${JSON.stringify(event)}`;
}

function saveState(): void {
  const state = {
    rooms: [...rooms.values()].map((room) => ({
      ...room,
      commitments: [...room.commitments.entries()],
      reveals: [...room.reveals.entries()]
    })),
    roomIdByContractId: [...roomIdByContractId.entries()],
    processedEvents: [...processedEvents.values()],
    relayIdempotency: [...relayIdempotency.entries()],
    pollerCursorBlock: pollerCursorBlock?.toString()
  };
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function loadState(): void {
  if (!existsSync(statePath)) return;
  const parsed = JSON.parse(readFileSync(statePath, "utf8")) as PersistedState;
  for (const room of parsed.rooms ?? []) {
    rooms.set(room.id, {
      ...room,
      commitments: new Map(room.commitments ?? []),
      reveals: new Map(room.reveals ?? [])
    });
  }
  for (const [contractRoomId, localRoomId] of parsed.roomIdByContractId ?? []) roomIdByContractId.set(contractRoomId, localRoomId);
  for (const eventId of parsed.processedEvents ?? []) processedEvents.add(eventId);
  for (const [key, value] of parsed.relayIdempotency ?? []) relayIdempotency.set(key, value);
  if (parsed.pollerCursorBlock && /^\d+$/.test(parsed.pollerCursorBlock)) {
    pollerCursorBlock = BigInt(parsed.pollerCursorBlock);
  }
}

function readIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

function removeValue(values: Address[], value: Address): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

function createChainLogPollerFromEnv(): ChainPollerConfig | null {
  const rpcUrl = process.env.FX_BENTO_RPC_URL;
  if (!rpcUrl || !validRpcUrl(rpcUrl)) return null;
  const factoryAddress = normalizeAddress(process.env.FX_BENTO_FACTORY_ADDRESS);
  const escrowAddress = normalizeAddress(process.env.FX_BENTO_ESCROW_ADDRESS);
  const settlementAddress = normalizeAddress(process.env.FX_BENTO_SETTLEMENT_ADDRESS);
  if (!factoryAddress && !escrowAddress && !settlementAddress) return null;
  const chainId = readNumber(process.env.FX_BENTO_CHAIN_ID, 31337);
  const fromBlock = readBigInt(process.env.FX_BENTO_FROM_BLOCK) ?? 0n;
  return {
    rpcUrl,
    chainId,
    pollIntervalMs: Math.max(readNumber(process.env.FX_BENTO_POLL_INTERVAL_MS, 12_000), 1_000),
    fromBlock,
    factoryAddress: factoryAddress ?? undefined,
    escrowAddress: escrowAddress ?? undefined,
    settlementAddress: settlementAddress ?? undefined
  };
}

function startChainLogPollerFromEnv(): void {
  const config = createChainLogPollerFromEnv();
  if (!config) return;
  void pollChainLogs(config);
  setInterval(() => {
    void pollChainLogs(config);
  }, config.pollIntervalMs);
}

async function pollChainLogs(config: ChainPollerConfig) {
  if (pollerBusy) return { skipped: true, reason: "poller busy" };
  pollerBusy = true;
  try {
    const client = createPublicClient({
      chain: {
        id: config.chainId,
        name: `fx-bento-${config.chainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } }
      },
      transport: http(config.rpcUrl)
    });
    const latestBlock = await client.getBlockNumber();
    const fromBlock = (pollerCursorBlock ?? config.fromBlock) + (pollerCursorBlock === null ? 0n : 1n);
    if (fromBlock > latestBlock) return { fromBlock: fromBlock.toString(), toBlock: latestBlock.toString(), applied: [], skipped: [] };
    const addresses = [config.factoryAddress, config.escrowAddress, config.settlementAddress].filter(
      (address): address is Address => address !== undefined
    );
    const logs = await client.getLogs({ address: addresses, fromBlock, toBlock: latestBlock });
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const log of logs) {
      const event = normalizeLogEvent(log);
      if (!event) {
        skipped.push(`${log.transactionHash ?? "unknown"}:${log.logIndex ?? "unknown"}`);
        continue;
      }
      const eventId = indexedEventId(event);
      if (processedEvents.has(eventId)) {
        skipped.push(eventId);
        continue;
      }
      if (!applyIndexedEvent(event)) {
        skipped.push(eventId);
        continue;
      }
      processedEvents.add(eventId);
      applied.push(eventId);
    }

    pollerCursorBlock = latestBlock;
    saveState();
    return { fromBlock: fromBlock.toString(), toBlock: latestBlock.toString(), applied, skipped };
  } finally {
    pollerBusy = false;
  }
}

function validRpcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  } catch {
    return false;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export default app;

if (import.meta.main) {
  Bun.serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });
  console.log("FX Bento backend listening on http://localhost:8787");
}
