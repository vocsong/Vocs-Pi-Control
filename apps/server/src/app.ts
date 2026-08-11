import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { Db } from "@pi-control/database";
import type { Logger } from "./logger.js";
import type { RealtimeHub } from "./realtime/hub.js";
import type { SessionManager } from "./sessions/manager.js";
import type { WorkspaceSessionManager } from "./sessions/workspaceSessions.js";
import type { SandboxManager } from "./sandbox/manager.js";
import type { AgentManager } from "./agents/agentManager.js";
import type { LeaseManager } from "./realtime/leases.js";
import { registerRealtime } from "./realtime/ws.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { registerSandboxContainerRoutes } from "./routes/sandboxes.js";
import { registerSandboxRoutes } from "./routes/sandbox.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerGitRoutes } from "./routes/git.js";
import { registerTerminalRoutes } from "./routes/terminals.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { GitWorktreeService } from "./git/worktrees.js";
import type { AppFastify } from "./types.js";

export interface AppDeps {
  logger: Logger;
  db: Db;
  hub: RealtimeHub;
  sessions: SessionManager;
  workspaceSessions: WorkspaceSessionManager;
  sandbox: SandboxManager;
  agents: AgentManager;
  worktrees: GitWorktreeService;
  leases: LeaseManager;
  runtimeName: string;
}

export async function buildApp(deps: AppDeps): Promise<AppFastify> {
  const app = Fastify({
    loggerInstance: deps.logger,
    // Local-first: bind loopback by default; Host/Origin validation is
    // enforced explicitly (ADR-0008).
    trustProxy: false,
  });

  // Boot the websocket plugin BEFORE registering routes: its onRoute hook
  // must wrap the /ws handler, otherwise the handler receives the fastify
  // request object instead of the WebSocket.
  await app.register(fastifyWebsocket);

  registerHealthRoutes(app, deps);
  registerSessionRoutes(app, deps.sessions, deps.workspaceSessions);
  registerWorkspaceRoutes(app, deps.sandbox);
  registerSandboxContainerRoutes(app, deps.sandbox, deps.agents);
  registerSandboxRoutes(app, deps.sandbox);
  registerFileRoutes(app, deps.agents);
  registerGitRoutes(app, deps.agents, deps.worktrees);
  registerTerminalRoutes(app, deps.agents);
  registerTaskRoutes(app, deps.db, deps.hub);
  registerRealtime(app, deps);

  return app as AppFastify;
}
