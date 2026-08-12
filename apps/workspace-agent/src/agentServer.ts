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
import { MockPiDriver } from "@pi-control/pi-driver/mock";
import { EmbeddedPiDriver } from "@pi-control/pi-driver/embedded";
import { AGENT_VERSION, type AgentConfig } from "./config.js";
import { runExec, toExitPayload } from "./exec.js";
import { FileService } from "./fileService.js";
import { GitService } from "./gitService.js";
import { ProcessSupervisor } from "./processSupervisor.js";
import { SessionSupervisor } from "./sessionSupervisor.js";
import { TerminalManager } from "./terminalManager.js";
import { listListeningPorts } from "./ports.js";

export interface AgentServerOptions {
  config: AgentConfig;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  /** For tests: skip the token requirement. */
  skipAuth?: boolean;
  /** Override the Pi driver (tests use the mock). */
  driver?: ReturnType<typeof createPiDriver>;
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
  const processSupervisor = new ProcessSupervisor({
    onStarted: (process: AgentProcessInfo) => broadcast({ type: "agent.process.started", payload: { process } }),
    onOutput: (payload) => broadcast({ type: "agent.process.output", payload }),
    onExited: (processId, exitCode) => broadcast({ type: "agent.process.exited", payload: { processId, exitCode } }),
  });

  const clients = new Set<WebSocket>();

  const sessionSupervisor = new SessionSupervisor(options.driver ?? createPiDriver(logger), {
    onEvent: (sessionId, envelope) => broadcast({ type: "agent.session.event", payload: { sessionId, envelope } }),
  });
  const workspaceRoot = process.env.PI_CONTROL_WORKSPACE_ROOT ?? "/workspace";
  const files = new FileService(workspaceRoot);
  const git = new GitService(workspaceRoot);
  const terminals = new TerminalManager(workspaceRoot, {
    onOutput: (terminalId, data) => broadcast({ type: "agent.terminal.output", payload: { id: terminalId, data } }),
    onClosed: (terminalId) => broadcast({ type: "agent.terminal.closed", payload: { id: terminalId } }),
  });

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
    processCount: processSupervisor.count(),
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
          processes: processSupervisor.list(),
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
          const payload = command.payload as { workspaceId?: string; env?: Record<string, string> };
          // V1 credential boundary: the control server supplies provider
          // env vars; apply them process-wide for Pi (ADR-0010 documents
          // that child shells inherit these until a credential broker lands).
          if (payload.env) {
            for (const [key, value] of Object.entries(payload.env)) {
              if (value) process.env[key] = value;
            }
          }
          socket.send(
            JSON.stringify({
              type: "agent.ready",
              payload: {
                workspaceId: payload.workspaceId ?? config.workspaceId,
                agentVersion: AGENT_VERSION,
                protocolVersion: AGENT_PROTOCOL_VERSION,
                processes: processSupervisor.list(),
                sessions: sessionSupervisor.list(),
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
          const process = processSupervisor.spawn(request);
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
          processSupervisor.kill(processId);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.process.list": {
          socket.send(
            JSON.stringify({
              type: "agent.process.list",
              payload: { processes: processSupervisor.list(), commandId: command.id },
            } satisfies AgentEvent),
          );
          return;
        }
        case "agent.shutdown": {
          processSupervisor.shutdown();
      terminals.shutdown();
          socket.send(JSON.stringify({ type: "agent.error", payload: { message: "shutting down" } } satisfies AgentEvent));
          socket.close();
          return;
        }
        case "agent.session.create": {
          const request = command.payload as { sessionId: string; title?: string; model?: string; thinkingLevel?: string };
          const info = await sessionSupervisor.create(request.sessionId, {
            title: request.title,
            model: request.model,
            thinkingLevel: request.thinkingLevel,
          });
          socket.send(
            JSON.stringify({
              type: "agent.session.created",
              payload: { ...info, commandId: command.id },
            } satisfies AgentEvent),
          );
          return;
        }
        case "agent.session.resume": {
          const request = command.payload as { sessionId: string; nativeSessionPath: string };
          const info = await sessionSupervisor.resume(request.sessionId, request.nativeSessionPath);
          socket.send(
            JSON.stringify({ type: "agent.session.created", payload: { ...info, commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.session.prompt": {
          const request = command.payload as { sessionId: string; text: string };
          await sessionSupervisor.prompt(request.sessionId, request.text);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.session.steer": {
          const request = command.payload as { sessionId: string; text: string };
          await sessionSupervisor.steer(request.sessionId, request.text);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.session.followUp": {
          const request = command.payload as { sessionId: string; text: string };
          await sessionSupervisor.followUp(request.sessionId, request.text);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.session.abort": {
          const request = command.payload as { sessionId: string };
          await sessionSupervisor.abort(request.sessionId);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.session.compact": {
          const request = command.payload as { sessionId: string };
          await sessionSupervisor.compact(request.sessionId);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.session.setModel": {
          const request = command.payload as { sessionId: string; model: string };
          await sessionSupervisor.setModel(request.sessionId, request.model);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.session.setThinkingLevel": {
          const request = command.payload as { sessionId: string; level: string };
          await sessionSupervisor.setThinkingLevel(request.sessionId, request.level);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.session.dispose": {
          const request = command.payload as { sessionId: string };
          await sessionSupervisor.dispose(request.sessionId);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.session.list": {
          socket.send(
            JSON.stringify({ type: "agent.session.list", payload: { sessions: sessionSupervisor.list(), commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.session.info": {
          const request = command.payload as { sessionId: string };
          const info = await sessionSupervisor.info(request.sessionId);
          socket.send(
            JSON.stringify({ type: "agent.session.info", payload: { sessionId: request.sessionId, info, commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.session.models": {
          const models = await sessionSupervisor.models();
          socket.send(JSON.stringify({ type: "agent.session.models", payload: { models, commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.session.transcript": {
          const request = command.payload as { sessionId: string; nativeSessionPath?: string; nativePiSessionId?: string };
          const messages = await sessionSupervisor.transcript(request.sessionId, request.nativeSessionPath, request.nativePiSessionId);
          socket.send(
            JSON.stringify({ type: "agent.session.transcript", payload: { sessionId: request.sessionId, messages, commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.file.list": {
          const request = command.payload as { path?: string };
          const entries = await files.list(request.path ?? "");
          socket.send(
            JSON.stringify({ type: "agent.file.list", payload: { entries, commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.file.read": {
          const request = command.payload as { path: string; maxBytes?: number };
          const result = await files.read(request.path, request.maxBytes);
          socket.send(
            JSON.stringify({
              type: "agent.file.read",
              payload: { path: request.path, commandId: command.id, ...result },
            } satisfies AgentEvent),
          );
          return;
        }
        case "agent.file.write": {
          const request = command.payload as { path: string; content: string; encoding?: "utf8" | "base64" };
          const bytes = await files.write(request.path, request.content, request.encoding);
          socket.send(
            JSON.stringify({
              type: "agent.file.ok",
              payload: { ok: true, path: request.path, bytes, commandId: command.id },
            } satisfies AgentEvent),
          );
          return;
        }
        case "agent.file.mkdir": {
          const request = command.payload as { path: string; recursive?: boolean };
          await files.mkdir(request.path, request.recursive ?? true);
          socket.send(
            JSON.stringify({ type: "agent.file.ok", payload: { ok: true, path: request.path, commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.file.remove": {
          const request = command.payload as { path: string; recursive?: boolean };
          await files.remove(request.path, request.recursive ?? false);
          socket.send(
            JSON.stringify({ type: "agent.file.ok", payload: { ok: true, path: request.path, commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.file.rename": {
          const request = command.payload as { from: string; to: string };
          await files.rename(request.from, request.to);
          socket.send(
            JSON.stringify({ type: "agent.file.ok", payload: { ok: true, path: request.to, commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.file.search": {
          const request = command.payload as { query: string; maxResults?: number };
          const matches = await files.search(request.query, request.maxResults);
          socket.send(
            JSON.stringify({ type: "agent.file.search", payload: { matches, commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.git.status": {
          const result = await git.status();
          socket.send(JSON.stringify({ type: "agent.git.status", payload: { ...result, commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.git.diff": {
          const request = command.payload as { staged?: boolean };
          const diff = await git.diff(request.staged ?? false);
          socket.send(JSON.stringify({ type: "agent.git.diff", payload: { diff, commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.git.stage": {
          const request = command.payload as { paths: string[] };
          await git.stage(request.paths);
          socket.send(JSON.stringify({ type: "agent.git.ok", payload: { ok: true, path: "", commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.git.unstage": {
          const request = command.payload as { paths: string[] };
          await git.unstage(request.paths);
          socket.send(JSON.stringify({ type: "agent.git.ok", payload: { ok: true, path: "", commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.git.commit": {
          const request = command.payload as { message: string };
          const hash = await git.commit(request.message);
          socket.send(JSON.stringify({ type: "agent.git.commit", payload: { hash, commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.git.branches": {
          const result = await git.branches();
          socket.send(JSON.stringify({ type: "agent.git.branches", payload: { ...result, commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.git.branchCreate": {
          const request = command.payload as { name: string; from?: string };
          await git.branchCreate(request.name, request.from);
          socket.send(JSON.stringify({ type: "agent.git.ok", payload: { ok: true, path: "", commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.git.log": {
          const request = command.payload as { max?: number };
          const entries = await git.log(request.max ?? 20);
          socket.send(JSON.stringify({ type: "agent.git.log", payload: { entries, commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.terminal.open": {
          const request = command.payload as { id: string; cols?: number; rows?: number; shell?: string };
          const terminal = terminals.open(request);
          socket.send(
            JSON.stringify({ type: "agent.terminal.opened", payload: { terminal, commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.terminal.input": {
          const request = command.payload as { id: string; data: string };
          terminals.write(request.id, request.data);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.terminal.resize": {
          const request = command.payload as { id: string; cols: number; rows: number };
          terminals.resize(request.id, request.cols, request.rows);
          socket.send(JSON.stringify({ type: "agent.ok", payload: { commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.terminal.close": {
          const request = command.payload as { id: string };
          terminals.close(request.id);
          socket.send(JSON.stringify({ type: "agent.terminal.closed", payload: { id: request.id, commandId: command.id } } satisfies AgentEvent));
          return;
        }
        case "agent.terminal.list": {
          socket.send(
            JSON.stringify({ type: "agent.terminal.list", payload: { terminals: terminals.list(), commandId: command.id } } satisfies AgentEvent),
          );
          return;
        }
        case "agent.ports.list": {
          const ports = await listListeningPorts();
          socket.send(JSON.stringify({ type: "agent.ports.list", payload: { ports, commandId: command.id } } satisfies AgentEvent));
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
      await sessionSupervisor.shutdown();
      for (const client of clients) client.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
    connectionCount: () => clients.size,
  };
}

function createPiDriver(logger: (message: string, meta?: Record<string, unknown>) => void) {
  const mode = process.env.PI_CONTROL_PI_DRIVER ?? "embedded";
  if (mode === "mock") {
    logger(`using MockPiDriver (PI_CONTROL_PI_DRIVER=${mode})`);
    return new MockPiDriver({ speedMs: 40 });
  }
  logger(`using EmbeddedPiDriver (real Pi SDK; cwd=/workspace agentDir=/state/pi-agent)`);
  return new EmbeddedPiDriver({
    cwd: "/workspace",
    agentDir: "/state/pi-agent",
    sessionDir: "/state/pi-sessions",
  });
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
