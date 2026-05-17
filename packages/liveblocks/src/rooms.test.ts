import { describe, expect, test } from "bun:test";

import {
  buildRoomPermissions,
  fxBentoArcadeRoom,
  fxTelaranaRoom,
  mcpWorkflowRoom,
  parseLiveblocksRoom,
  perpsMarketRoom,
} from ".";

describe("Liveblocks room helpers", () => {
  test("builds product room ids", () => {
    expect(perpsMarketRoom("USDC/EURC")).toBe("perps:USDC/EURC");
    expect(fxBentoArcadeRoom("room_123")).toBe("arcade:fx-bento:room_123");
    expect(fxTelaranaRoom("USDC/MXNB")).toBe("fx-telarana:USDC/MXNB");
    expect(mcpWorkflowRoom("wf_123")).toBe("mcp:wf_123");
  });

  test("parses product room ids", () => {
    expect(parseLiveblocksRoom("perps:USDC/EURC")).toEqual({
      kind: "perps",
      marketId: "USDC/EURC",
    });
    expect(parseLiveblocksRoom("arcade:fx-bento:quito-1")).toEqual({
      kind: "fx-bento",
      roomId: "quito-1",
    });
  });

  test("builds typed permissions", () => {
    expect(buildRoomPermissions(["mcp:wf_123"], "presence")).toEqual([
      {
        roomId: "mcp:wf_123",
        access: "presence",
        metadata: { kind: "mcp", product: "mcp", workflowId: "wf_123" },
      },
    ]);
  });
});
