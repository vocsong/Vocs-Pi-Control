/**
 * Agent WebSocket server.
 *
 * - Listens on the agent port INSIDE the sandbox (loopback only).
 * - Authenticates the control server via `Authorization: Bearer <token>`
 *   (constant-time compare) before any message is accepted.
 * - Dispatches AgentCommands to exec/process supervision and emits
 *   AgentEvents back.
 *
 * Security note: the token guards host-side access through the forwarded
 * port. A process already inside the sandbox can reach this socket without
 * the token's help — but it can already run arbitrary commands in the same
 * sandbox, so this grants no additional capability (documented in ADR-0006).
 */

import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  AGENT_COMMAND_TYPES,
  AGENT_PROTOCOL_VERSION,
  type AgentCommand,
  type AgentEvent,
  type AgentExecOutputPayload,
  type AgentHealthPayload,
  type AgentProcessInfo,
} from "@pi-control/protocol";
import { AGENT_VERSION, type AgentConfig } from "./config.js";
import { runExec, toExitPayload } from "./exec.js";
import { ProcessSupervisor } from "./processSupervisor.js";

export interface AgentServerOptions {
  config: AgentConfig;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  /** For tests: skip the token requirement. */
  skipAuth?: boolean;
}

export interface AgentServerHandle {
  close(): Promise<void>;
  /** Current number of connected control-server clients. */
  connectionCount(): number;
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return Buffer.compare(bufA, bufB) === 0;
}

export async function startAgentServer(options: AgentServerOptions): Promise<AgentServerHandle> {
  const { config, logger } = options;
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer, maxPayload: 4 * 1024 * 1024 });

  const supervisor = new ProcessSupervisor({
    onStarted: (process: AgentProcessInfo) => broadcast({ type: "agent.process.started", payload: { process } }),
    onOutput: (payload) => broadcast({ type: "agent.process.output", payload }),
    onExited: (processId, exitCode) => broadcast({ type: "agent.process.exited", payload: { processId, exitCode } }),
  });

  const clients = new Set<WebSocket>();

  const broadcast = (event: AgentEvent): void => {
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify(event));
      }
    }
  };

  const healthPayload = (): AgentHealthPayload => ({
    workspaceId: config.workspaceId,
    uptimeMs: process.uptime() * 1000,
    memory: {
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
    },
    cpuPercent: cpuPercent(),
    processCount: supervisor.count(),
    agentVersion: AGENT_VERSION,
  });

  wss.on("connection", (socket, request) => {
    const header = request.headers.authorization ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!options.skipAuth && (!config.token || !timingSafeEqual(supplied, config.token))) {
      logger("authentication failed; closing connection", { remote: request.socket.remoteAddress });
      socket.close(4001, "unauthorized");
      return;
    }

    clients.add(socket);
    logger("control server connected", { remote: request.socket.remoteAddress });
    socket.on("close", () => clients.delete(socket));

    socket.on("message", (raw) => {
      void handleMessage(socket, String(raw));
    });

    socket.send(
      JSON.stringify({
        type: "agent.ready",
        payload: {
          workspaceId: config.workspaceId,
          agentVersion: AGENT_VERSION,
          protocolVersion: AGENT_PROTOCOL_VERSION,
          processes: supervisor.list(),
        },
      } satisfies AgentEvent),
    );
  });

  async function handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let command: AgentCommand;
    try {
      command = JSON.parse(raw) as AgentCommand;
      if (!AGENT_COMMAND_TYPES.includes(command.type)) throw new Error("unknown command type");
    } catch (error) {
      socket.send(JSON.stringify({ type: "agent.error", payload: { message: String(error) } } satisfies AgentEvent));
      return;
    }

    try {
      switch (command.type) {
        case "agent.hello": {
          const payload = command.payload as { workspaceId?: string };
          socket.send(
            JSON.stringify({
              type: "agent.ready",
              payload: {
                workspaceId: payload.workspaceId ?? config.workspaceId,
                agentVersion: AGENT_VERSION,
                protocolVersion: AGENT_PROTOCOL_VERSION,
                processes: supervisor.list(),
              },
            } satisfies AgentEvent),
          );
          return;
        }
        case "agent.ping": {
          socket.send(JSON.stringify({ type: "agent.health", payload: healthPayload() } satisfies AgentEvent));
          return;
        }
        case "agent.exec": {
          const request = command.payload as Parameters<typeof runExec>[0];
          const emit = (stream: "stdout" | "stderr", text: string) => {
            const payload: AgentExecOutputPayload = { commandId: command.id, stream, text };
            socket.send(JSON.stringify({ type: "agent.exec.output", payload } satisfies AgentEvent));
          };
          const result = await runExec(request, emit);
          socket.send(JSON.stringify({ type: "agent.exec.exit", payload: toExitPayload(command.id, result) } satisfies AgentEvent));
          return;
        }
        case "agent.process.spawn": {
          const request = command.payload as Parameters<ProcessSupervisor["spawn"]>[0];
          const process = supervisor.spawn(request);
          socket.send(
            JSON.stringify({
              type: "agent.process.started",
              payload: { process, commandId: command.id },
            } satisfies AgentEvent),
          );
          return;
        }
        case "agent.process.kill": {
          const { processId } = command.payload as { processId: string };
          supervisor.kill(processId);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.process.list": {
          socket.send(
            JSON.stringify({
              type: "agent.process.list",
              payload: { processes: supervisor.list(), commandId: command.id },
            } satisfies AgentEvent),
          );
          return;
        }
        case "agent.shutdown": {
          supervisor.shutdown();
          socket.send(JSON.stringify({ type: "agent.error", payload: { message: "shutting down" } } satisfies AgentEvent));
          socket.close();
          return;
        }
      }
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "agent.error",
          payload: { message: error instanceof Error ? error.message : String(error), commandId: command.id },
        } satisfies AgentEvent),
      );
    }
  }

  // Heartbeat: broadcast health every 5 seconds.
  const healthTimer = setInterval(() => {
    if (clients.size > 0) broadcast({ type: "agent.health", payload: healthPayload() });
  }, 5000);

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });
  logger(`workspace agent listening on ws://${config.host}:${config.port}`, { workspaceId: config.workspaceId });

  return {
    async close() {
      clearInterval(healthTimer);
      supervisor.shutdown();
      for (const client of clients) client.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
    connectionCount: () => clients.size,
  };
}

let lastCpuSample: { time: number; usage: NodeJS.CpuUsage } | null = null;

function cpuPercent(): number | undefined {
  const now = Date.now();
  const usage = process.cpuUsage();
  if (lastCpuSample) {
    const elapsedMs = now - lastCpuSample.time;
    if (elapsedMs > 0) {
      const delta = usage.user - lastCpuSample.usage.user + (usage.system - lastCpuSample.usage.system);
      return Math.max(0, Math.min(100, Math.round((delta / 1000 / elapsedMs) * 100)));
    }
  }
  lastCpuSample = { time: now, usage };
  return undefined;
}
