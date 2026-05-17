import { beforeEach, describe, expect, test } from "bun:test";

import { recordFxBentoContractEvent, resetPonderStateForTests } from "@bufinance/fx-bento-ponder";

import { createWorkflow, runWorkflow, transitionWorkflow } from ".";

describe("MCP workflow state", () => {
  beforeEach(() => {
    resetPonderStateForTests();
  });

  test("financial tools start blocked on payment", () => {
    const workflow = createWorkflow({ toolName: "create_perp_intent" });
    expect(workflow.status).toBe("pending_payment");
    expect(workflow.requiredSignature).toBe(true);
  });

  test("read-only workflows can run to completion", () => {
    const workflow = createWorkflow({ toolName: "inspect_room_state" });
    expect(workflow.status).toBe("draft");
    const completed = runWorkflow(workflow.workflowId);
    expect(completed.status).toBe("completed");
  });

  test("inspect room state reads indexed FX Bento room state", () => {
    recordFxBentoContractEvent({
      contractName: "FXBentoRoomFactory",
      eventName: "RoomCreated",
      txHash: `0x${"ab".repeat(32)}` as `0x${string}`,
      logIndex: 1,
      blockNumber: 1n,
      args: {
        roomId: 12n,
        poolId: `0x${"12".repeat(32)}`,
        entryToken: "0x0000000000000000000000000000000000000001",
        entryFee: 5_000_000n,
      },
    });
    const workflow = createWorkflow({ toolName: "inspect_room_state", input: { roomId: "12" } });
    const completed = runWorkflow(workflow.workflowId);
    expect(completed.output?.room).toMatchObject({ roomId: "12", status: "lobby" });
  });

  test("rejects invalid transitions", () => {
    const workflow = createWorkflow({ toolName: "inspect_room_state" });
    expect(() => transitionWorkflow(workflow.workflowId, "completed")).toThrow();
  });
});
