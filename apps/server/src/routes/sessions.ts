import type { AppFastify } from "../types.js";
import { z } from "zod";
import { schema } from "@pi-control/database";
import { eq, asc } from "drizzle-orm";
import { EVENT_TYPES, type SessionInfo } from "@pi-control/protocol";
import { nowIso } from "@pi-control/shared";
import type { RealtimeHub } from "../realtime/hub.js";
import type { SessionManager } from "../sessions/manager.js";
import type { WorkspaceSessionManager } from "../sessions/workspaceSessions.js";

const createBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    model: z.string().min(1).max(200).optional(),
    thinkingLevel: z.string().min(1).max(50).optional(),
  })
  .strict();

const promptBody = z.object({ text: z.string().min(1).max(100_000) }).strict();

export function registerSessionRoutes(
  app: AppFastify,
  sessions: SessionManager,
  workspaceSessions: WorkspaceSessionManager,
  db: import("@pi-control/database").Db,
  hub: RealtimeHub,
): void {
  app.get("/api/sessions", async () => {
    return { sessions: [...sessions.list(), ...workspaceSessions.list()] };
  });

  app.post("/api/sessions", async (request, reply) => {
    const body = createBody.parse(request.body);
    const session = await sessions.createSession(body);
    return reply.code(201).send({ session });
  });

  app.post("/api/sandboxes/:sandboxId/sessions", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = createBody.parse(request.body);
    const session = await workspaceSessions.create(sandboxId, body);
    return reply.code(201).send({ session });
  });

  app.post("/api/sandboxes/:sandboxId/sessions/resume", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = z.object({ nativeSessionPath: z.string().min(1).max(4096) }).strict().parse(request.body);
    const session = await workspaceSessions.resume(sandboxId, body.nativeSessionPath);
    return reply.code(201).send({ session });
  });

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = sessions.get(sessionId) ?? workspaceSessions.get(sessionId);
    if (!session) return reply.code(404).send({ error: "not_found" });
    return { session };
  });

  app.post("/api/sessions/:sessionId/prompt", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = promptBody.parse(request.body);
    if (workspaceSessions.owns(sessionId)) {
      await workspaceSessions.prompt(sessionId, body.text);
    } else {
      await sessions.prompt(sessionId, body.text);
    }
    return { ok: true };
  });

  app.post("/api/sessions/:sessionId/abort", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (workspaceSessions.owns(sessionId)) {
      await workspaceSessions.abort(sessionId);
    } else {
      await sessions.abort(sessionId);
    }
    return { ok: true };
  });

  app.patch("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = z.object({ title: z.string().min(1).max(200) }).strict().parse(request.body);
    const row = sessions.get(sessionId) ?? workspaceSessions.get(sessionId);
    if (!row) return reply.code(404).send({ error: "not_found" });
    const now = nowIso();
    db.update(schema.sessions).set({ title: body.title, updatedAt: now }).where(eq(schema.sessions.id, sessionId)).run();
    const updated: SessionInfo = { ...row, title: body.title, updatedAt: now };
    hub.publish({
      scope: "session",
      sessionId,
      type: EVENT_TYPES.sessionUpdated,
      payload: { sessionId, session: updated },
    });
    return { session: updated };
  });

  app.delete("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (workspaceSessions.owns(sessionId)) {
      await workspaceSessions.dispose(sessionId);
    } else if (sessions.get(sessionId)) {
      await sessions.disposeSession(sessionId);
    } else {
      return reply.code(404).send({ error: "not_found" });
    }
    return { ok: true };
  });

  /* Phase 9 — Pi management controls */

  app.get("/api/sessions/:sessionId/traces", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = sessions.get(sessionId) ?? workspaceSessions.get(sessionId);
    if (!session) return reply.code(404).send({ error: "not_found" });
    const rows = db
      .select()
      .from(schema.traces)
      .where(eq(schema.traces.sessionId, sessionId))
      .orderBy(asc(schema.traces.startedAt))
      .all();
    const traces = rows.map((row) => {
      let metadata: unknown;
      try {
        metadata = row.metadataJson ? (JSON.parse(row.metadataJson) as unknown) : undefined;
      } catch {
        metadata = undefined;
      }
      return {
        id: row.id,
        type: row.type,
        status: row.status,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        metadata,
      };
    });
    return { traces };
  });

  app.get("/api/sessions/:sessionId/capabilities", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!workspaceSessions.owns(sessionId)) {
      return reply.code(404).send({ error: "not_a_workspace_session" });
    }
    try {
      return { capabilities: await workspaceSessions.capabilities(sessionId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/sandboxes/:sandboxId/models", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      return { models: await workspaceSessions.models(sandboxId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sessions/:sessionId/model", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = z.object({ model: z.string().min(1).max(300) }).strict().parse(request.body);
    if (!workspaceSessions.owns(sessionId)) return reply.code(404).send({ error: "not_a_workspace_session" });
    try {
      await workspaceSessions.setModel(sessionId, body.model);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sessions/:sessionId/thinking", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = z.object({ level: z.string().min(1).max(50) }).strict().parse(request.body);
    if (!workspaceSessions.owns(sessionId)) return reply.code(404).send({ error: "not_a_workspace_session" });
    try {
      await workspaceSessions.setThinkingLevel(sessionId, body.level);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/sessions/:sessionId/transcript", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!workspaceSessions.owns(sessionId)) return reply.code(404).send({ error: "not_a_workspace_session" });
    try {
      return { messages: await workspaceSessions.transcript(sessionId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sessions/:sessionId/compact", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!workspaceSessions.owns(sessionId)) return reply.code(404).send({ error: "not_a_workspace_session" });
    try {
      await workspaceSessions.compact(sessionId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
