import type { AppFastify } from "../types.js";
import { z } from "zod";
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
): void {
  app.get("/api/sessions", async () => {
    return { sessions: [...sessions.list(), ...workspaceSessions.list()] };
  });

  app.post("/api/sessions", async (request, reply) => {
    const body = createBody.parse(request.body);
    const session = await sessions.createSession(body);
    return reply.code(201).send({ session });
  });

  app.post("/api/workspaces/:workspaceId/sessions", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = createBody.parse(request.body);
    const session = await workspaceSessions.create(workspaceId, body);
    return reply.code(201).send({ session });
  });

  app.post("/api/workspaces/:workspaceId/sessions/resume", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = z.object({ nativeSessionPath: z.string().min(1).max(4096) }).strict().parse(request.body);
    const session = await workspaceSessions.resume(workspaceId, body.nativeSessionPath);
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
}
