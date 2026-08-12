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
import { GitWorktreeService } from "./git/worktrees.js";
import { AgentManager } from "./agents/agentManager.js";
import { recordTraceEvent } from "./observability/trace.js";
import { SettingsService } from "./settings/service.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { buildApp } from "./app.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Repository root (repo/workspaces is the default workspace root). */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

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
  const settings = new SettingsService(db, logger, path.join(REPO_ROOT, "workspaces"));
  settings.applyStoredKeysToEnv();
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
    recordTraceEvent(db, { scope: "session", sessionId, type: envelope.type, payload: envelope.payload });
    // Event checkpoint for reconnect/replay (plan §26).
    db.insert(schema.eventCheckpoints)
      .values({ scope: "session", scopeId: sessionId, lastSeq: hub.currentSeq(), updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: [schema.eventCheckpoints.scope, schema.eventCheckpoints.scopeId],
        set: { lastSeq: hub.currentSeq(), updatedAt: nowIso() },
      })
      .run();
  });
  // Merge stored provider keys into what agents receive at hello.
  agents.credentialSource = () => settings.providerEnv();
  const workspaceSessions = new WorkspaceSessionManager(
    db,
    agents,
    hub,
    logger,
    () => settings.defaults(),
    (sandboxId) => sandbox.ensureSandboxRunning(sandboxId),
  );

  const { runtime, detection, reason } = await selectRuntime(logger, process.env);
  logger.info({ runtime: runtime.name, reason, messages: detection.messages }, "sandbox runtime selected");

  const sandbox = new SandboxManager({
    db,
    runtime,
    hub,
    logger,
    agents,
    baseImage: process.env.PI_CONTROL_BASE_IMAGE ?? "pi-control/base:local",
    imagesDir: REPO_ROOT,
    rootFolder: () => settings.rootFolder(),
  });
  sandbox.restoreSandboxes();
  // Server restart policy: everything stopped, folders synced from the root.
  await sandbox.stopAllSandboxes();
  sandbox.syncWorkspacesFromRoot();
  // Live detection: folders added to the root appear as workspaces on disk.
  const syncTimer = setInterval(() => {
    try {
      sandbox.syncWorkspacesFromRoot();
    } catch (error) {
      logger.warn({ error: String(error) }, "workspace root sync failed");
    }
  }, 15_000);
  syncTimer.unref?.();
  await sandbox.refreshDetection();
  const worktrees = new GitWorktreeService(sandbox, logger);

  const app = await buildApp({ logger, db, hub, sessions, workspaceSessions, sandbox, agents, worktrees, leases, runtimeName: runtime.name });
  registerSettingsRoutes(app, settings, () => agents.reconnectAll());

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
