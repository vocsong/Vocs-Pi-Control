import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { AgentManager } from "../agents/agentManager.js";
import { DEV_PORT_RANGE } from "../sandbox/manager.js";

const openBody = z
  .object({ cols: z.number().int().min(2).max(500).optional(), rows: z.number().int().min(2).max(500).optional() })
  .strict();

const inputBody = z.object({ data: z.string().max(64 * 1024) }).strict();

const resizeBody = z
  .object({ cols: z.number().int().min(2).max(500), rows: z.number().int().min(2).max(500) })
  .strict();

export function registerTerminalRoutes(app: AppFastify, agents: AgentManager): void {
  app.get("/api/sandboxes/:sandboxId/terminals", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      return { terminals: await agents.listTerminals(sandboxId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/terminals", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = openBody.parse(request.body);
    const terminalId = `term_${crypto.randomUUID()}`;
    try {
      const terminal = await agents.openTerminal(sandboxId, terminalId, body.cols ?? 80, body.rows ?? 24);
      return reply.code(201).send({ terminal: { ...(terminal as object), id: terminalId } });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/terminals/:terminalId/input", async (request, reply) => {
    const { sandboxId, terminalId } = request.params as { sandboxId: string; terminalId: string };
    const body = inputBody.parse(request.body);
    try {
      await agents.terminalInput(sandboxId, terminalId, body.data);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/terminals/:terminalId/resize", async (request, reply) => {
    const { sandboxId, terminalId } = request.params as { sandboxId: string; terminalId: string };
    const body = resizeBody.parse(request.body);
    try {
      await agents.terminalResize(sandboxId, terminalId, body.cols, body.rows);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/terminals/:terminalId/close", async (request, reply) => {
    const { sandboxId, terminalId } = request.params as { sandboxId: string; terminalId: string };
    try {
      await agents.closeTerminal(sandboxId, terminalId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/sandboxes/:sandboxId/ports", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      const ports = await agents.listPorts(sandboxId);
      // Map listening container ports to host URLs within the published
      // dev range (loopback only).
      const exposed = ports
        .filter((p) => p.port >= DEV_PORT_RANGE.hostStart && p.port <= DEV_PORT_RANGE.hostStart + DEV_PORT_RANGE.count - 1)
        .map((p) => ({ containerPort: p.port, url: `http://127.0.0.1:${p.port}` }));
      return { ports: exposed };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
