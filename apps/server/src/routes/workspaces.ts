import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { SandboxManager } from "../sandbox/manager.js";

/** Create a workspace FOLDER under the workspace root. */
const createWorkspaceBody = z
  .object({
    name: z.string().min(1).max(200),
    hostRootPath: z.string().min(1).max(4096).optional(),
  })
  .strict();

export function registerWorkspaceRoutes(app: AppFastify, manager: SandboxManager): void {
  app.get("/api/workspaces", async () => {
    return { workspaces: manager.listWorkspaces() };
  });

  app.post("/api/workspaces", async (request, reply) => {
    const body = createWorkspaceBody.parse(request.body);
    const result = await manager.createWorkspace(body);
    return reply.code(201).send(result);
  });

  // Convenience: start the workspace = ensure its sandbox exists, then start it.
  app.post("/api/workspaces/:workspaceId/start", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      const sandbox = await manager.ensureSandbox(workspaceId);
      const started = await manager.startSandbox(sandbox.id);
      return { sandbox: started };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/stop", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      const sandbox = await manager.ensureSandbox(workspaceId);
      const stopped = await manager.stopSandbox(sandbox.id);
      return { sandbox: stopped };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
