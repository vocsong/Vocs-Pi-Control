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
  app.get("/api/workspaces/:workspaceId/git/status", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      const event = await agents.gitStatus(workspaceId);
      return event;
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/workspaces/:workspaceId/git/diff", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const query = z.object({ staged: z.enum(["1", "true"]).optional() }).parse(request.query);
    try {
      const event = await agents.gitDiff(workspaceId, query.staged === "1" || query.staged === "true");
      return event;
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/git/stage", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = pathsBody.parse(request.body);
    try {
      await agents.gitStage(workspaceId, body.paths);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/git/unstage", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = pathsBody.parse(request.body);
    try {
      await agents.gitUnstage(workspaceId, body.paths);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/git/commit", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = commitBody.parse(request.body);
    try {
      const event = await agents.gitCommit(workspaceId, body.message);
      return event;
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/workspaces/:workspaceId/git/branches", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      return await agents.gitBranches(workspaceId);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/workspaces/:workspaceId/git/branches", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = branchBody.parse(request.body);
    try {
      await agents.gitBranchCreate(workspaceId, body.name, body.from);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/workspaces/:workspaceId/git/log", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    try {
      return await agents.gitLog(workspaceId);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/projects/:projectId/worktrees", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = worktreeBody.parse(request.body);
    try {
      const created = await worktrees.create({ projectId, name: body.name, branch: body.branch });
      return reply.code(201).send({ worktree: created });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/projects/:projectId/worktrees", async (request) => {
    const { projectId } = request.params as { projectId: string };
    return { worktrees: worktrees.list(projectId) };
  });
}
