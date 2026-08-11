import type { AppFastify } from "../types.js";
import { z } from "zod";
import type { SessionManager } from "../sessions/manager.js";

const createBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    model: z.string().min(1).max(200).optional(),
    thinkingLevel: z.string().min(1).max(50).optional(),
  })
  .strict();

export function registerSessionRoutes(app: AppFastify, sessions: SessionManager): void {
  app.get("/api/sessions", async () => {
    return { sessions: sessions.list() };
  });

  app.post("/api/sessions", async (request, reply) => {
    const body = createBody.parse(request.body);
    const session = await sessions.createSession(body);
    return reply.code(201).send({ session });
  });

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session) return reply.code(404).send({ error: "not_found" });
    return { session };
  });

  app.post("/api/sessions/:sessionId/abort", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session) return reply.code(404).send({ error: "not_found" });
    await sessions.abort(sessionId);
    return { ok: true };
  });
}
