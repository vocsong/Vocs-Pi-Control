import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { SandboxManager } from "../sandbox/manager.js";

const createWorkspaceBody = z
  .object({
    name: z.string().min(1).max(200),
    hostPath: z.string().min(1).max(4096),
    securityProfile: z.enum(["standard", "restricted", "trusted"]).optional(),
    imageRef: z.string().min(1).max(500).optional(),
    resources: z
      .object({
        cpuCores: z.number().int().min(1).max(64).optional(),
        memoryGiB: z.number().min(1).max(128).optional(),
        pidLimit: z.number().int().min(64).max(100_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function registerWorkspaceRoutes(app: AppFastify, manager: SandboxManager): void {
  app.get("/api/workspaces", async () => {
    return { workspaces: manager.listWorkspaces() };
  });

  app.get("/api/projects/:projectId/workspaces", async (request) => {
    const { projectId } = request.params as { projectId: string };
    return { workspaces: manager.listWorkspaces(projectId) };
  });

  app.post("/api/projects/:projectId/workspaces", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = createWorkspaceBody.parse(request.body);
    const workspace = await manager.createWorkspace(projectId, body);
    return reply.code(201).send({ workspace });
  });

  app.get("/api/workspaces/:workspaceId", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      return { workspace: await manager.workspaceInfo(workspaceId) };
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
  });

  app.post("/api/workspaces/:workspaceId/start", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      return { workspace: await manager.startWorkspace(workspaceId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/stop", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      return { workspace: await manager.stopWorkspace(workspaceId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/remove", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      await manager.removeWorkspace(workspaceId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
