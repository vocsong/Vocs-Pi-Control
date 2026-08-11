import type { AppFastify } from "../types.js";
import { APP_VERSION } from "../config.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { SessionManager } from "../sessions/manager.js";
import type { SandboxManager } from "../sandbox/manager.js";
import type { Logger } from "../logger.js";
import type { Db } from "@pi-control/database";
import { schema } from "@pi-control/database";

export interface HealthDeps {
  logger: Logger;
  db: Db;
  hub: RealtimeHub;
  sessions: SessionManager;
  sandbox: SandboxManager;
  /** Sandbox runtime name in use ("mock" or "podman"). */
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

    const detection = await deps.sandbox.refreshDetection();

    return {
      status: dbOk ? "ok" : "degraded",
      service: "pi-control-server",
      version: APP_VERSION,
      uptimeMs: Math.round(process.uptime() * 1000),
      runtime: deps.runtimeName,
      sandbox: deps.sandbox.statusPayload(detection),
      database: dbOk ? "ok" : "error",
      realtime: { seq: deps.hub.currentSeq() },
      now: new Date().toISOString(),
    };
  });

  app.get("/api/diagnostics", async () => {
    const detection = await deps.sandbox.refreshDetection();
    return {
      version: APP_VERSION,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      runtime: deps.runtimeName,
      sandbox: {
        detected: detection.detected,
        rootlessAvailable: detection.rootlessAvailable,
        machineRequired: detection.machineRequired,
        machineConfigured: detection.machineConfigured,
        machineRunning: detection.machineRunning,
        podmanVersion: detection.version,
        messages: detection.messages,
      },
      database: {
        ok: true,
        projects: deps.sandbox.projectCount(),
        workspaces: deps.sandbox.workspaceCount(),
        sessions: deps.sessions.sessionCount(),
      },
      realtime: { seq: deps.hub.currentSeq() },
      now: new Date().toISOString(),
    };
  });
}
