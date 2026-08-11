import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { SandboxManager } from "../sandbox/manager.js";
import type { AgentManager } from "../agents/agentManager.js";

const createSandboxBody = z
  .object({
    name: z.string().min(1).max(200),
    hostPath: z.string().min(1).max(4096).optional(),
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

export function registerSandboxContainerRoutes(app: AppFastify, manager: SandboxManager, agents: AgentManager): void {
  app.get("/api/sandboxes", async () => {
    return { sandboxes: manager.listSandboxes() };
  });

  app.get("/api/workspaces/:workspaceId/sandboxes", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    return { sandboxes: manager.listSandboxes(workspaceId) };
  });

  app.post("/api/workspaces/:workspaceId/sandboxes", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = createSandboxBody.parse(request.body);
    const sandbox = await manager.createSandbox(workspaceId, body);
    return reply.code(201).send({ sandbox });
  });

  app.get("/api/sandboxes/:sandboxId", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      return { sandbox: await manager.sandboxInfo(sandboxId) };
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
  });

  app.post("/api/sandboxes/:sandboxId/start", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      return { sandbox: await manager.startSandbox(sandboxId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/stop", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      return { sandbox: await manager.stopSandbox(sandboxId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/remove", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      await manager.removeSandbox(sandboxId);
      agents.disconnect(sandboxId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/rebuild", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = z
      .object({ profile: z.enum(["node", "python", "universal"]).optional() })
      .strict()
      .parse(request.body ?? {});
    try {
      const sandbox = await manager.rebuildSandbox(sandboxId, body.profile);
      return { sandbox };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/sandboxes/:sandboxId/agent", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const status = agents.status(sandboxId);
    if (!status) return reply.code(404).send({ error: "no_agent_connection" });
    return { agent: status };
  });

  app.post("/api/sandboxes/:sandboxId/exec", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = z
      .object({
        command: z.array(z.string().min(1)).min(1).max(64),
        cwd: z.string().min(1).max(4096).optional(),
        timeoutMs: z.number().int().min(100).max(600_000).optional(),
        maxOutputBytes: z.number().int().min(1024).max(4 * 1024 * 1024).optional(),
      })
      .strict()
      .parse(request.body);
    try {
      const result = await agents.exec(sandboxId, body);
      return { result };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/sandboxes/:sandboxId/processes", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      return { processes: await agents.listProcesses(sandboxId) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/processes", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        command: z.array(z.string().min(1)).min(1).max(64),
        cwd: z.string().min(1).max(4096).optional(),
        env: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .parse(request.body);
    try {
      const process = await agents.spawnProcess(sandboxId, body);
      return reply.code(201).send({ process });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/processes/:processId/kill", async (request, reply) => {
    const { sandboxId, processId } = request.params as { sandboxId: string; processId: string };
    try {
      await agents.killProcess(sandboxId, processId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
