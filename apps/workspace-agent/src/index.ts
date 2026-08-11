/**
 * pi-control-workspace-agent entrypoint.
 *
 * Runs INSIDE each workspace container (and on the host for development and
 * tests). Owns workspace processes and (Phase 3+) Pi sessions; survives
 * browser and control-server disconnects (plan §11, ADR-0006).
 */

import { loadAgentConfig } from "./config.js";
import { startAgentServer } from "./agentServer.js";

async function main(): Promise<void> {
  const config = loadAgentConfig();
  const logger = (message: string, meta: Record<string, unknown> = {}) => {
    // Structured-ish logging; the container logs are collected via `podman logs`.
    const line = { time: new Date().toISOString(), message, ...meta };
    process.stdout.write(JSON.stringify(line) + "\n");
  };

  if (!config.token) {
    logger(
      "PI_CONTROL_AGENT_TOKEN is not set — the control server cannot authenticate to this agent. " +
        "Staying alive but idle (this is normal for ad-hoc container use).",
    );
    setInterval(() => undefined, 60_000);
    return;
  }

  const handle = await startAgentServer({ config, logger });

  const shutdown = (signal: string) => {
    logger("shutting down", { signal });
    void handle.close().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main();
