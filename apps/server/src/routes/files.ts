import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { AgentManager } from "../agents/agentManager.js";

const filePathSchema = z.object({ path: z.string().min(1).max(4096) }).strict();

const listQuery = z.object({ path: z.string().max(4096).optional().default("") }).strict();

const writeBody = z
  .object({
    path: z.string().min(1).max(4096),
    content: z.string(),
    encoding: z.enum(["utf8", "base64"]).optional(),
  })
  .strict();

const mkdirBody = z.object({ path: z.string().min(1).max(4096) }).strict();

const removeBody = z
  .object({ path: z.string().min(1).max(4096), recursive: z.boolean().optional() })
  .strict();

const renameBody = z
  .object({ from: z.string().min(1).max(4096), to: z.string().min(1).max(4096) })
  .strict();

export function registerFileRoutes(app: AppFastify, agents: AgentManager): void {
  app.get("/api/workspaces/:workspaceId/files", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const query = listQuery.parse(request.query);
    try {
      return { entries: await agents.listFiles(workspaceId, query.path) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/workspaces/:workspaceId/file", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const query = filePathSchema.parse(request.query);
    try {
      return { file: await agents.readFile(workspaceId, query.path) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/workspaces/:workspaceId/file/search", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const query = z.object({ q: z.string().min(1).max(200), max: z.coerce.number().int().min(1).max(200).optional() }).parse(request.query);
    try {
      return { matches: await agents.searchFiles(workspaceId, query.q, query.max) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/workspaces/:workspaceId/file", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = writeBody.parse(request.body);
    try {
      return { result: await agents.writeFile(workspaceId, body.path, body.content, body.encoding) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/file/mkdir", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = mkdirBody.parse(request.body);
    try {
      await agents.mkdirFile(workspaceId, body.path);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/file/remove", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = removeBody.parse(request.body);
    try {
      await agents.removeFile(workspaceId, body.path, body.recursive);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/file/rename", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = renameBody.parse(request.body);
    try {
      await agents.renameFile(workspaceId, body.from, body.to);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
