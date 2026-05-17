import { z } from "zod";

const segment = z.string().min(1).max(96).regex(/^[A-Za-z0-9._/-]+$/);

export const LiveblocksRoomKindSchema = z.enum(["perps", "fx-bento", "fx-telarana", "mcp"]);

export type LiveblocksRoomKind = z.infer<typeof LiveblocksRoomKindSchema>;

export type ParsedLiveblocksRoom =
  | { kind: "perps"; marketId: string }
  | { kind: "fx-bento"; roomId: string }
  | { kind: "fx-telarana"; marketId: string }
  | { kind: "mcp"; workflowId: string };

export interface LiveblocksRoomMetadata {
  kind: LiveblocksRoomKind;
  product: "perps" | "fx-bento" | "fx-telarana" | "mcp";
  marketId?: string;
  roomId?: string;
  workflowId?: string;
  title?: string;
  createdBy?: string;
}

export type FxPresence = {
  userId: string;
  wallet: string | null;
  displayName: string;
  role: "player" | "trader" | "lender" | "agent" | "spectator" | "operator";
  cursorX: number | null;
  cursorY: number | null;
  tileHover: string | null;
  selectedTilePreview: string | null;
  panel: "lobby" | "room" | "board" | "trade" | "workflow" | "market" | null;
  status: "idle" | "ready" | "pending_signature" | "pending_payment" | "running" | null;
  [key: string]: string | number | boolean | null;
};

export interface FxBentoRoomStorage {
  countdownEndsAt: number | null;
  leaderboardPreview: Array<{ wallet: string; score: number }>;
  chat: Array<{ id: string; wallet: string; body: string; at: number }>;
}

function safeSegment(value: string): string {
  return segment.parse(value);
}

export function perpsMarketRoom(marketId: string): string {
  return `perps:${safeSegment(marketId)}`;
}

export function fxBentoArcadeRoom(roomId: string): string {
  return `arcade:fx-bento:${safeSegment(roomId)}`;
}

export function fxTelaranaRoom(marketId: string): string {
  return `fx-telarana:${safeSegment(marketId)}`;
}

export function mcpWorkflowRoom(workflowId: string): string {
  return `mcp:${safeSegment(workflowId)}`;
}

export function parseLiveblocksRoom(roomId: string): ParsedLiveblocksRoom | null {
  const perps = /^perps:([^:]+)$/.exec(roomId);
  if (perps) return { kind: "perps", marketId: perps[1] };
  const arcade = /^arcade:fx-bento:([^:]+)$/.exec(roomId);
  if (arcade) return { kind: "fx-bento", roomId: arcade[1] };
  const telarana = /^fx-telarana:([^:]+)$/.exec(roomId);
  if (telarana) return { kind: "fx-telarana", marketId: telarana[1] };
  const mcp = /^mcp:([^:]+)$/.exec(roomId);
  if (mcp) return { kind: "mcp", workflowId: mcp[1] };
  return null;
}

export function metadataForRoom(roomId: string): LiveblocksRoomMetadata {
  const parsed = parseLiveblocksRoom(roomId);
  if (!parsed) throw new Error(`Unsupported Liveblocks room: ${roomId}`);
  switch (parsed.kind) {
    case "perps":
      return { kind: "perps", product: "perps", marketId: parsed.marketId };
    case "fx-bento":
      return { kind: "fx-bento", product: "fx-bento", roomId: parsed.roomId };
    case "fx-telarana":
      return { kind: "fx-telarana", product: "fx-telarana", marketId: parsed.marketId };
    case "mcp":
      return { kind: "mcp", product: "mcp", workflowId: parsed.workflowId };
  }
}

export const INITIAL_FX_BENTO_STORAGE: FxBentoRoomStorage = {
  countdownEndsAt: null,
  leaderboardPreview: [],
  chat: [],
};
