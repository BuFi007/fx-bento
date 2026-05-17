import { Liveblocks } from "@liveblocks/node";

import {
  fxBentoArcadeRoom,
  fxTelaranaRoom,
  mcpWorkflowRoom,
  metadataForRoom,
  parseLiveblocksRoom,
  perpsMarketRoom,
  type LiveblocksRoomMetadata,
} from "./rooms";

export type LiveblocksAccess = "read" | "presence" | "write" | "full";

export interface LiveblocksIdentity {
  userId: string;
  wallet: string | null;
  sessionId?: string;
  displayName: string;
  avatarUrl?: string | null;
  role?: "player" | "trader" | "lender" | "agent" | "spectator" | "operator";
}

export interface RoomPermission {
  roomId: string;
  access: LiveblocksAccess;
  metadata: LiveblocksRoomMetadata;
}

let cachedClient: Liveblocks | null | undefined;

export function createLiveblocksClient(secret = process.env.LIVEBLOCKS_SECRET_KEY): Liveblocks | null {
  if (cachedClient !== undefined && secret === process.env.LIVEBLOCKS_SECRET_KEY) return cachedClient;
  if (!secret) {
    cachedClient = null;
    return null;
  }
  cachedClient = new Liveblocks({ secret });
  return cachedClient;
}

export function getUserLiveblocksIdentity(input: {
  wallet?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  displayName?: string | null;
  role?: LiveblocksIdentity["role"];
}): LiveblocksIdentity {
  const wallet = input.wallet?.toLowerCase() ?? null;
  const userId = input.userId ?? (wallet ? `wallet:${wallet}` : input.sessionId ? `session:${input.sessionId}` : null);
  if (!userId) throw new Error("Liveblocks identity requires wallet, userId, or sessionId");
  return {
    userId,
    wallet,
    sessionId: input.sessionId ?? undefined,
    displayName: input.displayName ?? (wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : userId),
    role: input.role ?? "spectator",
  };
}

export function buildRoomPermissions(
  roomIds: string[],
  access: LiveblocksAccess = "presence"
): RoomPermission[] {
  return roomIds.map((roomId) => {
    const parsed = parseLiveblocksRoom(roomId);
    if (!parsed) throw new Error(`Unsupported Liveblocks room: ${roomId}`);
    return { roomId, access, metadata: metadataForRoom(roomId) };
  });
}

export async function authorizeLiveblocksRoom(args: {
  identity: LiveblocksIdentity;
  roomIds: string[];
  access?: LiveblocksAccess;
  secret?: string;
}): Promise<{ token: string; permissions: RoomPermission[] }> {
  const client = createLiveblocksClient(args.secret);
  if (!client) throw new Error("LIVEBLOCKS_SECRET_KEY is not configured");

  const permissions = buildRoomPermissions(args.roomIds, args.access ?? "full");
  const session = client.prepareSession(args.identity.userId, {
    userInfo: {
      name: args.identity.displayName,
      avatar: args.identity.avatarUrl ?? undefined,
      color: colorForUser(args.identity.userId),
      wallet: args.identity.wallet ?? undefined,
      role: args.identity.role ?? "spectator",
      kind: args.identity.role === "agent" ? "agent" : "human",
    },
  });

  for (const permission of permissions) {
    session.allow(
      permission.roomId,
      permission.access === "full" || permission.access === "write"
        ? session.FULL_ACCESS
        : session.READ_ACCESS
    );
  }

  const response = await session.authorize();
  if (response.status !== 200) {
    throw new Error(`Liveblocks authorize failed: ${response.status}`);
  }

  return { token: JSON.parse(response.body).token as string, permissions };
}

export async function ensureLiveblocksRoom(args: {
  roomId: string;
  title?: string;
  url?: string;
  secret?: string;
}): Promise<void> {
  const client = createLiveblocksClient(args.secret);
  if (!client) return;
  await client.getOrCreateRoom(args.roomId, {
    defaultAccesses: [],
    metadata: {
      ...metadataForRoom(args.roomId),
      title: args.title ?? args.roomId,
      url: args.url ?? "/",
    },
  });
}

function colorForUser(id: string): string {
  const palette = ["#d23b68", "#168f75", "#315fb3", "#946323", "#7a4bc9", "#b83b2f"];
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

export {
  fxBentoArcadeRoom,
  fxTelaranaRoom,
  mcpWorkflowRoom,
  metadataForRoom,
  parseLiveblocksRoom,
  perpsMarketRoom,
};
