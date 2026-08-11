import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { SandboxManager } from "../sandbox/manager.js";

const createProjectBody = z
  .object({
    name: z.string().min(1).max(200),
    hostRootPath: z.string().min(1).max(4096),
  })
  .strict();

export function registerProjectRoutes(app: AppFastify, manager: SandboxManager): void {
  app.get("/api/projects", async () => {
    return { projects: manager.listProjects() };
  });

  app.post("/api/projects", async (request, reply) => {
    const body = createProjectBody.parse(request.body);
    const project = manager.createProject(body);
    return reply.code(201).send({ project });
  });
}
