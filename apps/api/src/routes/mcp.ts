import {
  ToolNameSchema,
  createWorkflow,
  getWorkflow,
  listTools,
  listWorkflows,
  runWorkflow,
} from "@bufinance/fx-bento-mcp";
import { Hono } from "hono";
import z from "zod";

import { parseJson } from "../lib/validation";

const CreateWorkflowSchema = z.object({
  toolName: ToolNameSchema,
  input: z.record(z.unknown()).default({}),
  paid: z.boolean().default(false),
  signed: z.boolean().default(false),
});

export const mcpRoutes = new Hono();

mcpRoutes.get("/mcp/tools", (c) => c.json({ tools: listTools() }));

mcpRoutes.get("/mcp/workflows", (c) => c.json({ workflows: listWorkflows() }));

mcpRoutes.post("/mcp/workflows", async (c) => {
  const body = await parseJson(c, CreateWorkflowSchema);
  return c.json(createWorkflow(body), 201);
});

mcpRoutes.get("/mcp/workflows/:id", (c) => {
  const workflow = getWorkflow(c.req.param("id"));
  return workflow ? c.json(workflow) : c.json({ error: "workflow_not_found" }, 404);
});

mcpRoutes.post("/mcp/workflows/:id/run", (c) => c.json(runWorkflow(c.req.param("id"))));
