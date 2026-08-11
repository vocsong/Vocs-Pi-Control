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
    const workspace = manager.createWorkspace(body);
    return reply.code(201).send({ workspace });
  });
}
