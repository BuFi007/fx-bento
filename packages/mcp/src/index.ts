import { mcpWorkflowRoom } from "@bufinance/fx-bento-liveblocks";
import { inspectFxBentoIndexedRoom, inspectPonderState } from "@bufinance/fx-bento-ponder";
import { AddressSchema, WalletSessionSchema, nowIso } from "@bufinance/fx-bento-shared-types";
import z from "zod";

export const WorkflowStatusSchema = z.enum([
  "draft",
  "pending_signature",
  "pending_payment",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const ToolNameSchema = z.enum([
  "create_fx_bento_room",
  "join_fx_bento_room",
  "settle_fx_bento_room",
  "inspect_room_state",
  "inspect_perps_market",
  "quote_perp_trade",
  "create_perp_intent",
  "inspect_liquidation_candidates",
  "inspect_fx_telarana_market",
  "inspect_loan_position",
  "trigger_safe_indexing_sync",
  "inspect_oracle_freshness",
  "inspect_ponder_state",
]);

export const WorkflowSchema = z.object({
  workflowId: z.string().min(1),
  user: WalletSessionSchema.optional(),
  wallet: AddressSchema.optional(),
  status: WorkflowStatusSchema,
  toolName: ToolNameSchema,
  input: z.record(z.unknown()).default({}),
  output: z.record(z.unknown()).nullable().default(null),
  requiredPayment: z
    .object({
      amount: z.string(),
      asset: z.string(),
      network: z.string(),
    })
    .nullable()
    .default(null),
  requiredSignature: z.boolean().default(false),
  liveblocksRoomId: z.string(),
  auditLog: z.array(z.object({ at: z.string(), event: z.string(), payload: z.record(z.unknown()) })).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ToolName = z.infer<typeof ToolNameSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;

export interface ToolDefinition {
  name: ToolName;
  description: string;
  requiresPayment: boolean;
  requiresSignature: boolean;
  financial: boolean;
}

export const toolRegistry: ToolDefinition[] = [
  {
    name: "create_fx_bento_room",
    description: "Create an FX Bento room draft and return required escrow action.",
    requiresPayment: true,
    requiresSignature: true,
    financial: true,
  },
  {
    name: "join_fx_bento_room",
    description: "Join an FX Bento room after user-authorized payment intent.",
    requiresPayment: false,
    requiresSignature: true,
    financial: true,
  },
  {
    name: "settle_fx_bento_room",
    description: "Prepare a settlement workflow for attested FX Bento results.",
    requiresPayment: true,
    requiresSignature: true,
    financial: true,
  },
  {
    name: "inspect_room_state",
    description: "Inspect indexed and backend room state.",
    requiresPayment: false,
    requiresSignature: false,
    financial: false,
  },
  {
    name: "inspect_perps_market",
    description: "Inspect perps market metadata.",
    requiresPayment: false,
    requiresSignature: false,
    financial: false,
  },
  {
    name: "quote_perp_trade",
    description: "Generate a perps quote preview.",
    requiresPayment: true,
    requiresSignature: false,
    financial: false,
  },
  {
    name: "create_perp_intent",
    description: "Create a signed perps trade intent.",
    requiresPayment: true,
    requiresSignature: true,
    financial: true,
  },
  {
    name: "inspect_liquidation_candidates",
    description: "Inspect liquidation candidates from indexed state.",
    requiresPayment: false,
    requiresSignature: false,
    financial: false,
  },
  {
    name: "inspect_fx_telarana_market",
    description: "Inspect FX Telarana lending market metadata.",
    requiresPayment: false,
    requiresSignature: false,
    financial: false,
  },
  {
    name: "inspect_loan_position",
    description: "Inspect an indexed lending/borrow position.",
    requiresPayment: false,
    requiresSignature: false,
    financial: false,
  },
  {
    name: "trigger_safe_indexing_sync",
    description: "Request a bounded indexer sync/reconciliation.",
    requiresPayment: true,
    requiresSignature: false,
    financial: false,
  },
  {
    name: "inspect_oracle_freshness",
    description: "Inspect oracle freshness for a market.",
    requiresPayment: false,
    requiresSignature: false,
    financial: false,
  },
  {
    name: "inspect_ponder_state",
    description: "Inspect Ponder indexed state.",
    requiresPayment: false,
    requiresSignature: false,
    financial: false,
  },
];

const workflows = new Map<string, Workflow>();

export function listTools(): ToolDefinition[] {
  return toolRegistry;
}

export function getTool(name: string): ToolDefinition | null {
  const parsed = ToolNameSchema.safeParse(name);
  if (!parsed.success) return null;
  return toolRegistry.find((tool) => tool.name === parsed.data) ?? null;
}

export function createWorkflow(args: {
  toolName: ToolName;
  input?: Record<string, unknown>;
  user?: z.infer<typeof WalletSessionSchema>;
  paid?: boolean;
  signed?: boolean;
}): Workflow {
  const tool = getTool(args.toolName);
  if (!tool) throw new Error("tool_not_found");
  const workflowId = `wf_${crypto.randomUUID().slice(0, 12)}`;
  const status = initialStatus(tool, args.paid ?? false, args.signed ?? false);
  const now = nowIso();
  const workflow = WorkflowSchema.parse({
    workflowId,
    user: args.user,
    wallet: args.user?.wallet,
    status,
    toolName: tool.name,
    input: args.input ?? {},
    output: null,
    requiredPayment: tool.requiresPayment ? { amount: "0.01", asset: "USDC", network: "x402" } : null,
    requiredSignature: tool.requiresSignature,
    liveblocksRoomId: mcpWorkflowRoom(workflowId),
    auditLog: [{ at: now, event: "workflow.created", payload: { status } }],
    createdAt: now,
    updatedAt: now,
  });
  workflows.set(workflow.workflowId, workflow);
  return workflow;
}

export function getWorkflow(workflowId: string): Workflow | null {
  return workflows.get(workflowId) ?? null;
}

export function listWorkflows(): Workflow[] {
  return [...workflows.values()];
}

export function transitionWorkflow(workflowId: string, nextStatus: WorkflowStatus, payload: Record<string, unknown> = {}) {
  const workflow = requireWorkflow(workflowId);
  const allowed = allowedTransitions[workflow.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`invalid_transition:${workflow.status}->${nextStatus}`);
  }
  workflow.status = nextStatus;
  workflow.updatedAt = nowIso();
  workflow.auditLog.push({ at: workflow.updatedAt, event: `workflow.${nextStatus}`, payload });
  return workflow;
}

export function runWorkflow(workflowId: string) {
  const workflow = requireWorkflow(workflowId);
  if (workflow.status === "pending_payment" || workflow.status === "pending_signature") {
    return workflow;
  }
  if (workflow.status === "draft") transitionWorkflow(workflowId, "running");
  const current = requireWorkflow(workflowId);
  current.output = executeTool(current);
  current.status = "completed";
  current.updatedAt = nowIso();
  current.auditLog.push({ at: current.updatedAt, event: "workflow.completed", payload: current.output });
  return current;
}

function executeTool(workflow: Workflow): Record<string, unknown> {
  if (workflow.toolName === "inspect_ponder_state") {
    return { events: inspectPonderState(workflow.input) };
  }
  if (workflow.toolName === "inspect_room_state") {
    const roomId = typeof workflow.input.roomId === "string" ? workflow.input.roomId : "";
    const chainId =
      typeof workflow.input.chainId === "number" || typeof workflow.input.chainId === "string"
        ? Number(workflow.input.chainId)
        : undefined;
    return { room: roomId ? inspectFxBentoIndexedRoom({ roomId, chainId }) : null };
  }
  return {
    accepted: true,
    toolName: workflow.toolName,
    note: "Scaffold execution only; financial actions require explicit wallet signature and onchain submission.",
  };
}

function initialStatus(tool: ToolDefinition, paid: boolean, signed: boolean): WorkflowStatus {
  if (tool.requiresPayment && !paid) return "pending_payment";
  if (tool.requiresSignature && !signed) return "pending_signature";
  return "draft";
}

function requireWorkflow(workflowId: string): Workflow {
  const workflow = workflows.get(workflowId);
  if (!workflow) throw new Error("workflow_not_found");
  return workflow;
}

const allowedTransitions: Record<WorkflowStatus, WorkflowStatus[]> = {
  draft: ["pending_payment", "pending_signature", "running", "cancelled"],
  pending_payment: ["pending_signature", "running", "cancelled", "failed"],
  pending_signature: ["running", "cancelled", "failed"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};
