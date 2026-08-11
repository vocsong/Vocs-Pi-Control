import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { AgentManager } from "../agents/agentManager.js";
import type { GitWorktreeService } from "../git/worktrees.js";

const pathsBody = z.object({ paths: z.array(z.string().min(1).max(4096)).max(1000) }).strict();

const commitBody = z.object({ message: z.string().min(1).max(5000) }).strict();

const branchBody = z
  .object({ name: z.string().min(1).max(200), from: z.string().min(1).max(200).optional() })
  .strict();

const worktreeBody = z
  .object({
    name: z.string().min(1).max(100),
    branch: z.string().min(1).max(200).optional(),
  })
  .strict();

export function registerGitRoutes(app: AppFastify, agents: AgentManager, worktrees: GitWorktreeService): void {
  app.get("/api/sandboxes/:sandboxId/git/status", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      const event = await agents.gitStatus(sandboxId);
      return event;
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/sandboxes/:sandboxId/git/diff", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const query = z.object({ staged: z.enum(["1", "true"]).optional() }).parse(request.query);
    try {
      const event = await agents.gitDiff(sandboxId, query.staged === "1" || query.staged === "true");
      return event;
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/git/stage", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = pathsBody.parse(request.body);
    try {
      await agents.gitStage(sandboxId, body.paths);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/git/unstage", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = pathsBody.parse(request.body);
    try {
      await agents.gitUnstage(sandboxId, body.paths);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/git/commit", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = commitBody.parse(request.body);
    try {
      const event = await agents.gitCommit(sandboxId, body.message);
      return event;
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/sandboxes/:sandboxId/git/branches", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      return await agents.gitBranches(sandboxId);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sandboxes/:sandboxId/git/branches", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    const body = branchBody.parse(request.body);
    try {
      await agents.gitBranchCreate(sandboxId, body.name, body.from);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/sandboxes/:sandboxId/git/log", async (request, reply) => {
    const { sandboxId } = request.params as { sandboxId: string };
    try {
      return await agents.gitLog(sandboxId);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/worktrees", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = worktreeBody.parse(request.body);
    try {
      const created = await worktrees.create({ workspaceId, name: body.name, branch: body.branch });
      return reply.code(201).send({ worktree: created });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/workspaces/:workspaceId/worktrees", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    return { worktrees: worktrees.list(workspaceId) };
  });
}
