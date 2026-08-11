import type { AppFastify } from "../types.js";
import { APP_VERSION } from "../config.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { SessionManager } from "../sessions/manager.js";
import type { Logger } from "../logger.js";
import type { Db } from "@pi-control/database";
import { schema } from "@pi-control/database";

export interface HealthDeps {
  logger: Logger;
  db: Db;
  hub: RealtimeHub;
  sessions: SessionManager;
  /** Sandbox runtime name in use ("mock" in Phase 0). */
  runtimeName: string;
}

export function registerHealthRoutes(app: AppFastify, deps: HealthDeps): void {
  app.get("/api/health", async () => {
    const dbOk = (() => {
      try {
        deps.db.select().from(schema.settings).limit(1).all();
        return true;
      } catch (error) {
        deps.logger.error({ error: String(error) }, "database health check failed");
        return false;
      }
    })();

    return {
      status: dbOk ? "ok" : "degraded",
      service: "pi-control-server",
      version: APP_VERSION,
      uptimeMs: Math.round(process.uptime() * 1000),
      runtime: deps.runtimeName,
      database: dbOk ? "ok" : "error",
      realtime: { seq: deps.hub.currentSeq() },
      now: new Date().toISOString(),
    };
  });

  app.get("/api/diagnostics", async () => {
    const projectCount = deps.db.select().from(schema.projects).all().length;
    const workspaceCount = deps.db.select().from(schema.workspaces).all().length;
    const sessionCount = deps.sessions.sessionCount();
    return {
      version: APP_VERSION,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      runtime: deps.runtimeName,
      database: { ok: true, projects: projectCount, workspaces: workspaceCount, sessions: sessionCount },
      realtime: { seq: deps.hub.currentSeq() },
      now: new Date().toISOString(),
    };
  });
}
