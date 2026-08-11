/**
 * Pi Control control-server entrypoint.
 *
 * Phase 0: local-first server with SQLite control plane, realtime hub and
 * mock Pi driver. Rootless Podman runtime bootstrap follows in Phase 1.
 */

import { MockPiDriver } from "@pi-control/pi-driver/mock";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { openDatabase, ensureLocalMachine } from "./db.js";
import { RealtimeHub } from "./realtime/hub.js";
import { SessionManager } from "./sessions/manager.js";
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
  const sessions = new SessionManager(
    db,
    hub,
    () => new MockPiDriver({ speedMs: 60 }),
    logger,
  );

  const app = await buildApp({ logger, db, hub, sessions, runtimeName: "mock" });

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info(`pi-control server listening on http://${config.host}:${config.port}`);
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
