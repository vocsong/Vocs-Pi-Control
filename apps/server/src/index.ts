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
import { RealtimeHub } from "./realtime/hub.js";
import { SessionManager } from "./sessions/manager.js";
import { SandboxManager } from "./sandbox/manager.js";
import { selectRuntime } from "./sandbox/runtimeFactory.js";
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
  const sessions = new SessionManager(db, hub, () => new MockPiDriver({ speedMs: 60 }), logger);

  const { runtime, detection, reason } = await selectRuntime(logger, process.env);
  logger.info({ runtime: runtime.name, reason, messages: detection.messages }, "sandbox runtime selected");

  const sandbox = new SandboxManager({
    db,
    runtime,
    hub,
    logger,
    baseImage: process.env.PI_CONTROL_BASE_IMAGE ?? "pi-control/base:local",
  });
  sandbox.restoreSandboxes();
  await sandbox.refreshDetection();

  const app = await buildApp({ logger, db, hub, sessions, sandbox, runtimeName: runtime.name });

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
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
