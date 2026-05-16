import { Hono } from "hono";
import { cors } from "hono/cors";
import { Liveblocks } from "@liveblocks/node";

type RoomRecord = {
  id: string;
  market: string;
  entryFee: string;
  players: string[];
  status: "lobby" | "active" | "settling" | "settled" | "cancelled";
  leaderboard: Array<{ player: string; score: number }>;
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
    market: body.market ?? "USDC/EURC",
    entryFee: body.entryFee ?? "5 USDC",
    players: [],
    status: "lobby",
    leaderboard: []
  };
  rooms.set(id, room);
  return c.json(room, 201);
});

app.get("/arcade/rooms", (c) => c.json([...rooms.values()]));

app.get("/arcade/rooms/:id", (c) => {
  const room = rooms.get(c.req.param("id"));
  return room ? c.json(room) : c.json({ error: "room not found" }, 404);
});

app.post("/arcade/rooms/:id/join-intent", async (c) => {
  const room = rooms.get(c.req.param("id"));
  if (!room) return c.json({ error: "room not found" }, 404);
  const { player } = await c.req.json();
  if (typeof player !== "string") return c.json({ error: "player required" }, 400);
  if (!room.players.includes(player)) room.players.push(player);
  return c.json({ roomId: room.id, player, message: "Submit entry fee onchain; backend is not custody." });
});

app.post("/arcade/rooms/:id/commit", async (c) => {
  const body = await c.req.json();
  return c.json({ roomId: c.req.param("id"), accepted: true, commitment: body.commitment });
});

app.post("/arcade/rooms/:id/reveal", async (c) => {
  const body = await c.req.json();
  return c.json({ roomId: c.req.param("id"), accepted: true, selection: body.selection });
});

app.get("/arcade/rooms/:id/leaderboard", (c) => {
  const room = rooms.get(c.req.param("id"));
  return room ? c.json(room.leaderboard) : c.json({ error: "room not found" }, 404);
});

app.post("/arcade/rooms/:id/settle", async (c) => {
  const room = rooms.get(c.req.param("id"));
  if (!room) return c.json({ error: "room not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  room.status = "settling";
  return c.json({ roomId: room.id, status: room.status, resultsRoot: body.resultsRoot ?? null });
});

app.post("/liveblocks/auth", async (c) => {
  if (!liveblocks) return c.json({ error: "LIVEBLOCKS_SECRET_KEY is not configured" }, 503);
  const { userId, roomId } = await c.req.json();
  const session = liveblocks.prepareSession(String(userId), { userInfo: { name: String(userId) } });
  session.allow(`fx-bento:${roomId}`, session.FULL_ACCESS);
  const { status, body } = await session.authorize();
  return new Response(body, { status });
});

export default app;

if (import.meta.main) {
  Bun.serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });
  console.log("FX Bento backend listening on http://localhost:8787");
}
