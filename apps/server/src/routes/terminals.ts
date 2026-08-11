import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { AgentManager } from "../agents/agentManager.js";
import { DEV_PORT_RANGE_START, DEV_PORT_RANGE_END } from "../sandbox/manager.js";

const openBody = z
  .object({ cols: z.number().int().min(2).max(500).optional(), rows: z.number().int().min(2).max(500).optional() })
  .strict();

const inputBody = z.object({ data: z.string().max(64 * 1024) }).strict();

const resizeBody = z
  .object({ cols: z.number().int().min(2).max(500), rows: z.number().int().min(2).max(500) })
  .strict();

export function registerTerminalRoutes(app: AppFastify, agents: AgentManager): void {
  app.get("/api/workspaces/:workspaceId/terminals", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      return { terminals: await agents.listTerminals(workspaceId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/terminals", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = openBody.parse(request.body);
    const terminalId = `term_${crypto.randomUUID()}`;
    try {
      const terminal = await agents.openTerminal(workspaceId, terminalId, body.cols ?? 80, body.rows ?? 24);
      return reply.code(201).send({ terminal: { ...(terminal as object), id: terminalId } });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/terminals/:terminalId/input", async (request, reply) => {
    const { workspaceId, terminalId } = request.params as { workspaceId: string; terminalId: string };
    const body = inputBody.parse(request.body);
    try {
      await agents.terminalInput(workspaceId, terminalId, body.data);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/terminals/:terminalId/resize", async (request, reply) => {
    const { workspaceId, terminalId } = request.params as { workspaceId: string; terminalId: string };
    const body = resizeBody.parse(request.body);
    try {
      await agents.terminalResize(workspaceId, terminalId, body.cols, body.rows);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/terminals/:terminalId/close", async (request, reply) => {
    const { workspaceId, terminalId } = request.params as { workspaceId: string; terminalId: string };
    try {
      await agents.closeTerminal(workspaceId, terminalId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/workspaces/:workspaceId/ports", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      const ports = await agents.listPorts(workspaceId);
      // Map listening container ports to host URLs within the published
      // dev range (loopback only).
      const exposed = ports
        .filter((p) => p.port >= DEV_PORT_RANGE_START && p.port <= DEV_PORT_RANGE_END)
        .map((p) => ({ containerPort: p.port, url: `http://127.0.0.1:${p.port}` }));
      return { ports: exposed };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
