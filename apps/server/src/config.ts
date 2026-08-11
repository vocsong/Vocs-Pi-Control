import os from "node:os";
import path from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  logLevel: string;
}

/** Application version surfaced in health/diagnostics. */
export const APP_VERSION = "0.0.0";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.PI_CONTROL_DATA_DIR ?? path.join(os.homedir(), ".pi-control");
  return {
    host: env.PI_CONTROL_HOST ?? "127.0.0.1",
    port: Number(env.PI_CONTROL_PORT ?? 5174),
    dataDir,
    dbPath: env.PI_CONTROL_DB_PATH ?? path.join(dataDir, "pi-control.db"),
    logLevel: env.PI_CONTROL_LOG_LEVEL ?? "info",
  };
}
