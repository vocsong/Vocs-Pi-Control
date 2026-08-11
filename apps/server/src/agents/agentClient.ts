/**
 * AgentClient — control-server connection to one workspace agent.
 *
 * The server connects OUT to the agent's loopback-forwarded port and
 * authenticates with the per-sandbox token. Reconnects with backoff; the
 * agent is the owner of workspace processes, so a server restart never
 * disturbs them (ADR-0006).
 */

import { WebSocket } from "ws";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentCommand,
  type AgentEvent,
  type AgentExecExitPayload,
  type AgentExecRequest,
  type AgentHealthPayload,
  type AgentProcessInfo,
  type AgentProcessSpawnRequest,
  type AgentReadyPayload,
} from "@pi-control/protocol";
import type { Logger } from "../logger.js";

export type AgentConnectionState = "connecting" | "connected" | "disconnected";

export interface AgentClientEvents {
  onReady(info: AgentReadyPayload): void;
  onHealth(health: AgentHealthPayload): void;
  onProcessStarted(process: AgentProcessInfo): void;
  onProcessOutput(payload: { processId: string; stream: "stdout" | "stderr"; text: string }): void;
  onProcessExited(processId: string, exitCode: number): void;
  onSessionEvent(sessionId: string, envelope: { scope: string; sessionId: string; type: string; payload: unknown }): void;
  onState(state: AgentConnectionState, detail?: string): void;
}

export interface AgentClientOptions {
  url: string;
  token: string;
  workspaceId: string;
  events: AgentClientEvents;
  logger: Logger;
  /** Provider credential env vars forwarded at hello (V1 boundary). */
  credentials?: Record<string, string>;
  reconnectBaseMs?: number;
}

interface PendingRequest {
  resolve(event: AgentEvent): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class AgentClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectDelay: number;
  private readonly pending = new Map<string, PendingRequest>();
  private connected = false;

  constructor(private readonly options: AgentClientOptions) {
    this.reconnectDelay = options.reconnectBaseMs ?? 1000;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
    this.options.events.onState("disconnected", "stopped");
  }

  get state(): AgentConnectionState {
    return this.connected ? "connected" : this.stopped ? "disconnected" : "connecting";
  }

  async request<T = unknown>(type: AgentCommand["type"], payload: unknown, timeoutMs = 30_000): Promise<AgentEvent<T>> {
    if (!this.connected || !this.ws) {
      throw new Error(`agent not connected (${this.options.workspaceId})`);
    }
    const id = crypto.randomUUID();
    return new Promise<AgentEvent<T>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`agent command timed out: ${type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (e: AgentEvent) => void, reject, timeout });
      const command: AgentCommand = { id, type, payload };
      this.ws?.send(JSON.stringify(command));
    });
  }

  async exec(request: AgentExecRequest): Promise<AgentExecExitPayload> {
    const exit = await this.request<AgentExecExitPayload>("agent.exec", request, (request.timeoutMs ?? 120_000) + 10_000);
    return exit.payload;
  }

  async spawnProcess(request: AgentProcessSpawnRequest): Promise<AgentProcessInfo> {
    const event = await this.request<{ process: AgentProcessInfo }>("agent.process.spawn", request);
    return event.payload.process;
  }

  async killProcess(processId: string): Promise<void> {
    await this.request("agent.process.kill", { processId });
  }

  async listProcesses(): Promise<AgentProcessInfo[]> {
    const event = await this.request<{ processes: AgentProcessInfo[] }>("agent.process.list", {});
    return event.payload.processes;
  }

  /* ------------------------------------------------------------------ */

  private connect(): void {
    if (this.stopped) return;
    this.options.events.onState("connecting");
    const ws = new WebSocket(this.options.url, {
      headers: { authorization: `Bearer ${this.options.token}` },
      handshakeTimeout: 10_000,
    });
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectDelay = this.options.reconnectBaseMs ?? 1000;
      this.connected = true;
      this.options.events.onState("connected");
      // Identify; the agent answers with agent.ready (also sent on connect).
      const hello: AgentCommand = {
        id: crypto.randomUUID(),
        type: "agent.hello",
        payload: {
          workspaceId: this.options.workspaceId,
          agentVersion: "pi-control-server",
          protocolVersion: AGENT_PROTOCOL_VERSION,
          ...(this.options.credentials && Object.keys(this.options.credentials).length > 0
            ? { env: this.options.credentials }
            : {}),
        },
      };
      ws.send(JSON.stringify(hello));
    });

    ws.on("message", (raw) => {
      this.handleEvent(raw.toString());
    });

    ws.on("close", (code, reason) => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.ws = null;
      this.rejectPending(new Error(`agent connection closed: ${code} ${reason}`));
      this.options.events.onState("disconnected", `close ${code}`);
      if (!this.stopped) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      }
    });

    ws.on("error", () => {
      ws.close();
    });
  }

  private handleEvent(raw: string): void {
    let event: AgentEvent;
    try {
      event = JSON.parse(raw) as AgentEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case "agent.ready":
        this.options.events.onReady(event.payload as AgentReadyPayload);
        return;
      case "agent.health":
        this.options.events.onHealth(event.payload as AgentHealthPayload);
        return;
      case "agent.process.started": {
        const payload = event.payload as { process: AgentProcessInfo; commandId?: string };
        // With commandId this is the response to an agent.process.spawn
        // command; without it, it's the broadcast of a spawn.
        if (payload.commandId) {
          this.resolve(payload.commandId, event);
        } else {
          this.options.events.onProcessStarted(payload.process);
        }
        return;
      }
      case "agent.process.output":
        this.options.events.onProcessOutput(event.payload as { processId: string; stream: "stdout" | "stderr"; text: string });
        return;
      case "agent.process.exited":
        this.options.events.onProcessExited(
          (event.payload as { processId: string }).processId,
          (event.payload as { exitCode: number }).exitCode,
        );
        return;
      case "agent.session.event":
        this.options.events.onSessionEvent(
          (event.payload as { sessionId: string }).sessionId,
          (event.payload as { envelope: { scope: string; sessionId: string; type: string; payload: unknown } }).envelope,
        );
        return;
      case "agent.session.created":
      case "agent.session.list":
        this.resolve((event.payload as { commandId?: string }).commandId ?? "", event);
        return;
      case "agent.exec.exit":
        this.resolve((event.payload as { commandId: string }).commandId, event);
        return;
      case "agent.ok":
        this.resolve((event.payload as { commandId: string }).commandId, event);
        return;
      case "agent.process.list":
        this.resolve((event.payload as { commandId: string }).commandId, event);
        return;
      case "agent.exec.output":
        return; // exec output is aggregated server-side via exec.exit
      case "agent.error": {
        const payload = event.payload as { message: string; commandId?: string };
        if (payload.commandId) {
          const pending = this.pending.get(payload.commandId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(payload.commandId);
            pending.reject(new Error(payload.message));
          }
        } else {
          this.options.logger.warn({ workspaceId: this.options.workspaceId, error: payload.message }, "agent error");
        }
        return;
      }
    }
  }

  private resolve(commandId: string, event: AgentEvent): void {
    const pending = this.pending.get(commandId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(commandId);
    pending.resolve(event);
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}
