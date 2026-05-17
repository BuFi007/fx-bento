import {
  authorizeLiveblocksRoom,
  getUserLiveblocksIdentity,
  type LiveblocksAccess,
} from "@bufinance/fx-bento-liveblocks";
import { readEnv } from "@bufinance/fx-bento-env";
import { Hono } from "hono";
import z from "zod";

import { parseJson } from "../lib/validation";

const LiveblocksAuthSchema = z.object({
  roomId: z.string().optional(),
  roomIds: z.array(z.string()).optional(),
  wallet: z.string().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  displayName: z.string().optional(),
  role: z.enum(["player", "trader", "lender", "agent", "spectator", "operator"]).default("spectator"),
  access: z.enum(["read", "presence", "write", "full"]).default("presence"),
});

export const liveblocksRoutes = new Hono();

liveblocksRoutes.post("/liveblocks/auth", async (c) => {
  const env = readEnv();
  const body = await parseJson(c, LiveblocksAuthSchema);
  const roomIds = body.roomIds ?? (body.roomId ? [body.roomId] : []);
  if (roomIds.length === 0) return c.json({ error: "roomId or roomIds required" }, 400);
  const hasOperatorKey = !!env.API_SECRET_KEY && c.req.header("X-API-Key") === env.API_SECRET_KEY;
  const role = hasOperatorKey ? body.role : body.wallet ? "player" : "spectator";
  const access = hasOperatorKey ? body.access : role === "spectator" ? "read" : "presence";

  const identity = getUserLiveblocksIdentity({
    wallet: body.wallet,
    sessionId: body.sessionId,
    userId: body.userId,
    displayName: body.displayName,
    role,
  });

  try {
    const result = await authorizeLiveblocksRoom({
      identity,
      roomIds,
      access: access as LiveblocksAccess,
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LIVEBLOCKS_SECRET_KEY")) {
      return c.json({ error: "liveblocks_not_configured", message }, 503);
    }
    throw error;
  }
});
