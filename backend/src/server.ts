import { Liveblocks } from "@liveblocks/node";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAddress, isAddress, recoverAddress, type Address, type Hex } from "viem";
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

const app = new Hono();
const liveblocksSecret = process.env.LIVEBLOCKS_SECRET_KEY;
const liveblocks = liveblocksSecret ? new Liveblocks({ secret: liveblocksSecret }) : null;
const rooms = new Map<string, RoomRecord>();

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
  return c.json(toPublicRoom(room));
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
  return rooms.get(id);
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

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export default app;

if (import.meta.main) {
  Bun.serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });
  console.log("FX Bento backend listening on http://localhost:8787");
}
