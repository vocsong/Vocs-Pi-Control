import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { SandboxManager } from "../sandbox/manager.js";
import type { AgentManager } from "../agents/agentManager.js";

const createWorkspaceBody = z
  .object({
    name: z.string().min(1).max(200),
    hostPath: z.string().min(1).max(4096),
    securityProfile: z.enum(["standard", "restricted", "trusted"]).optional(),
    profile: z.enum(["node", "python", "universal"]).optional(),
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

const execBody = z
  .object({
    command: z.array(z.string().min(1)).min(1).max(64),
    cwd: z.string().min(1).max(4096).optional(),
    timeoutMs: z.number().int().min(100).max(600_000).optional(),
    maxOutputBytes: z.number().int().min(1024).max(4 * 1024 * 1024).optional(),
  })
  .strict();

const spawnProcessBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    command: z.array(z.string().min(1)).min(1).max(64),
    cwd: z.string().min(1).max(4096).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export function registerWorkspaceRoutes(app: AppFastify, manager: SandboxManager, agents: AgentManager): void {
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
      agents.disconnect(workspaceId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/rebuild", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = z
      .object({ profile: z.enum(["node", "python", "universal"]).optional() })
      .strict()
      .parse(request.body ?? {});
    try {
      const workspace = await manager.rebuildWorkspace(workspaceId, body.profile);
      return { workspace };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /* Agent + process supervision (Phase 2) */

  app.get("/api/workspaces/:workspaceId/agent", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const status = agents.status(workspaceId);
    if (!status) return reply.code(404).send({ error: "no_agent_connection" });
    return { agent: status };
  });

  app.post("/api/workspaces/:workspaceId/exec", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = execBody.parse(request.body);
    try {
      const result = await agents.exec(workspaceId, body);
      return { result };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/workspaces/:workspaceId/processes", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      return { processes: await agents.listProcesses(workspaceId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/processes", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = spawnProcessBody.parse(request.body);
    try {
      const process = await agents.spawnProcess(workspaceId, body);
      return reply.code(201).send({ process });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/processes/:processId/kill", async (request, reply) => {
    const { workspaceId, processId } = request.params as { workspaceId: string; processId: string };
    try {
      await agents.killProcess(workspaceId, processId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
