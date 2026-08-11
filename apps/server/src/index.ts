/**
 * Pi Control control-server entrypoint.
 *
 * Phase 1: local-first server with SQLite control plane, realtime hub,
 * mock Pi driver (Phase 3 replaces it), and rootless Podman sandbox
 * runtime with machine bootstrap and security self-test.
 */

import { MockPiDriver } from "@pi-control/pi-driver/mock";
import { loadConfig, APP_VERSION } from "./config.js";
import { createLogger } from "./logger.js";
import { openDatabase, ensureLocalMachine } from "./db.js";
import { schema } from "@pi-control/database";
import { eq } from "drizzle-orm";
import { nowIso } from "@pi-control/shared";
import { RealtimeHub } from "./realtime/hub.js";
import { LeaseManager } from "./realtime/leases.js";
import { SessionManager } from "./sessions/manager.js";
import { WorkspaceSessionManager } from "./sessions/workspaceSessions.js";
import { SandboxManager } from "./sandbox/manager.js";
import { selectRuntime } from "./sandbox/runtimeFactory.js";
import { AgentManager } from "./agents/agentManager.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info(
    { dataDir: config.dataDir, dbPath: config.dbPath, host: config.host, port: config.port },
    "pi-control server starting",
  );

  const db = openDatabase(config.dbPath);
  ensureLocalMachine(db);

  const hub = new RealtimeHub(logger);
  const leases = new LeaseManager({
    // Advisory by default; set PI_CONTROL_ENFORCE_LEASES=1 to reject prompts
    // from clients that do not hold the editing lease.
    enforcePrompts: process.env.PI_CONTROL_ENFORCE_LEASES === "1",
  });
  const sessions = new SessionManager(db, hub, () => new MockPiDriver({ speedMs: 60 }), logger);
  // Keep workspace session statuses + event checkpoints in the control plane
  // in sync with agent events.
  const agents = new AgentManager(hub, logger, (sessionId, envelope) => {
    if (envelope.type === "session.state") {
      const status = (envelope.payload as { status?: string }).status;
      if (status) {
        db.update(schema.sessions)
          .set({ status, updatedAt: nowIso(), lastActivityAt: nowIso() })
          .where(eq(schema.sessions.id, sessionId))
          .run();
      }
    }
    // Event checkpoint for reconnect/replay (plan §26).
    db.insert(schema.eventCheckpoints)
      .values({ scope: "session", scopeId: sessionId, lastSeq: hub.currentSeq(), updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: [schema.eventCheckpoints.scope, schema.eventCheckpoints.scopeId],
        set: { lastSeq: hub.currentSeq(), updatedAt: nowIso() },
      })
      .run();
  });
  const workspaceSessions = new WorkspaceSessionManager(db, agents, hub, logger);

  const { runtime, detection, reason } = await selectRuntime(logger, process.env);
  logger.info({ runtime: runtime.name, reason, messages: detection.messages }, "sandbox runtime selected");

  const sandbox = new SandboxManager({
    db,
    runtime,
    hub,
    logger,
    agents,
    baseImage: process.env.PI_CONTROL_BASE_IMAGE ?? "pi-control/base:local",
  });
  sandbox.restoreSandboxes();
  sandbox.restoreAgents();
  await sandbox.refreshDetection();

  const app = await buildApp({ logger, db, hub, sessions, workspaceSessions, sandbox, agents, leases, runtimeName: runtime.name });

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info(`pi-control server listening on http://${config.host}:${config.port} (v${APP_VERSION})`);
  } catch (error) {
    logger.error({ error: String(error) }, "server failed to start");
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    try {
      agents.shutdown();
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
