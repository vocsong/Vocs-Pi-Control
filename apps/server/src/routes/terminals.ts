import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { AgentManager } from "../agents/agentManager.js";
import { devRangeForSlot, slotForDevHostStart } from "../sandbox/devPorts.js";
import { schema, type Db } from "@pi-control/database";
import { eq } from "drizzle-orm";

const openBody = z
  .object({ cols: z.number().int().min(2).max(500).optional(), rows: z.number().int().min(2).max(500).optional() })
  .strict();

const inputBody = z.object({ data: z.string().max(64 * 1024) }).strict();

const resizeBody = z
  .object({ cols: z.number().int().min(2).max(500), rows: z.number().int().min(2).max(500) })
  .strict();

export function registerTerminalRoutes(app: AppFastify, agents: AgentManager, db: Db): void {
  /** This sandbox's published host-side dev range (slot-aware, legacy = slot 0). */
  function devRangeFor(sandboxId: string): { hostStart: number; containerStart: number; count: number } {
    const row = db
      .select()
      .from(schema.sandboxes)
      .where(eq(schema.sandboxes.workspaceId, sandboxId))
      .get();
    let start: number | undefined;
    if (row?.configJson) {
      try {
        const spec = JSON.parse(row.configJson) as { devHostStart?: number };
        start = spec.devHostStart;
      } catch {
        /* malformed config → legacy slot 0 */
      }
    }
    return devRangeForSlot(slotForDevHostStart(start));
  }

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
      // Map listening container ports to host URLs within this sandbox's
      // published dev range (loopback only, slot-aware).
      const range = devRangeFor(sandboxId);
      const exposed = ports
        .filter((p) => p.port >= range.containerStart && p.port < range.containerStart + range.count)
        .map((p) => ({
          containerPort: p.port,
          url: `http://127.0.0.1:${range.hostStart + (p.port - range.containerStart)}`,
        }));
      return { ports: exposed };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
