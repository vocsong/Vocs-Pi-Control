/**
 * AgentManager — one AgentClient per workspace; bridges agent events into
 * browser protocol envelopes (scope: workspace).
 */

import {
  EVENT_TYPES,
  type AgentExecRequest,
  type AgentHealthPayload,
  type AgentProcessInfo,
  type AgentProcessSpawnRequest,
  type AgentReadyPayload,
} from "@pi-control/protocol";
import type { RealtimeHub } from "../realtime/hub.js";
import type { Logger } from "../logger.js";
import { AgentClient, type AgentConnectionState } from "./agentClient.js";

export interface AgentEndpoint {
  url: string;
  token: string;
}

export interface AgentStatus {
  workspaceId: string;
  state: AgentConnectionState;
  agentVersion?: string;
  protocolVersion?: number;
  lastHealth?: AgentHealthPayload;
  processes: AgentProcessInfo[];
  detail?: string;
}

export class AgentManager {
  private readonly clients = new Map<string, AgentClient>();
  private readonly statuses = new Map<string, AgentStatus>();

  constructor(
    private readonly hub: RealtimeHub,
    private readonly logger: Logger,
  ) {}

  /** Start (or restart) the connection for a workspace. */
  connect(workspaceId: string, endpoint: AgentEndpoint): void {
    const existing = this.clients.get(workspaceId);
    if (existing) {
      existing.stop();
      this.clients.delete(workspaceId);
    }

    const status: AgentStatus = { workspaceId, state: "connecting", processes: [] };
    this.statuses.set(workspaceId, status);

    const client = new AgentClient({
      url: endpoint.url,
      token: endpoint.token,
      workspaceId,
      logger: this.logger,
      events: {
        onReady: (info) => this.handleReady(workspaceId, status, info),
        onHealth: (health) => this.handleHealth(workspaceId, status, health),
        onProcessStarted: (process) => this.handleProcessStarted(workspaceId, status, process),
        onProcessOutput: (payload) => this.handleProcessOutput(workspaceId, payload),
        onProcessExited: (processId, exitCode) => this.handleProcessExited(workspaceId, status, processId, exitCode),
        onState: (state, detail) => this.handleState(workspaceId, status, state, detail),
      },
    });
    this.clients.set(workspaceId, client);
    client.start();
  }

  disconnect(workspaceId: string): void {
    this.clients.get(workspaceId)?.stop();
    this.clients.delete(workspaceId);
    this.statuses.delete(workspaceId);
  }

  status(workspaceId: string): AgentStatus | null {
    return this.statuses.get(workspaceId) ?? null;
  }

  async exec(workspaceId: string, request: AgentExecRequest) {
    return this.require(workspaceId).exec(request);
  }

  async spawnProcess(workspaceId: string, request: AgentProcessSpawnRequest): Promise<AgentProcessInfo> {
    return this.require(workspaceId).spawnProcess(request);
  }

  async killProcess(workspaceId: string, processId: string): Promise<void> {
    await this.require(workspaceId).killProcess(processId);
  }

  async listProcesses(workspaceId: string): Promise<AgentProcessInfo[]> {
    try {
      return await this.require(workspaceId).listProcesses();
    } catch {
      return this.statuses.get(workspaceId)?.processes ?? [];
    }
  }

  /** Stop all agent connections (server shutdown). */
  shutdown(): void {
    for (const [workspaceId, client] of this.clients) {
      client.stop();
      this.clients.delete(workspaceId);
    }
  }

  /* ------------------------------------------------------------------ */

  private require(workspaceId: string): AgentClient {
    const client = this.clients.get(workspaceId);
    if (!client) throw new Error(`No agent connection for workspace ${workspaceId}`);
    return client;
  }

  private handleReady(workspaceId: string, status: AgentStatus, info: AgentReadyPayload): void {
    status.agentVersion = info.agentVersion;
    status.protocolVersion = info.protocolVersion;
    status.processes = info.processes;
    status.state = "connected";
    this.logger.info(
      { workspaceId, agentVersion: info.agentVersion, processes: info.processes.length },
      "workspace agent connected",
    );
    this.publish(workspaceId, EVENT_TYPES.agentState, {
      workspaceId,
      state: "connected",
      agentVersion: info.agentVersion,
    });
    for (const process of info.processes) {
      this.publish(workspaceId, EVENT_TYPES.processStarted, { workspaceId, process });
    }
  }

  private handleHealth(workspaceId: string, status: AgentStatus, health: AgentHealthPayload): void {
    status.lastHealth = health;
    status.state = "connected";
    this.publish(workspaceId, EVENT_TYPES.agentHealth, { ...health, workspaceId });
  }

  private handleProcessStarted(workspaceId: string, status: AgentStatus, process: AgentProcessInfo): void {
    const existing = status.processes.findIndex((p) => p.id === process.id);
    if (existing >= 0) status.processes[existing] = process;
    else status.processes.push(process);
    this.publish(workspaceId, EVENT_TYPES.processStarted, { workspaceId, process });
  }

  private handleProcessOutput(
    workspaceId: string,
    payload: { processId: string; stream: "stdout" | "stderr"; text: string },
  ): void {
    this.publish(workspaceId, EVENT_TYPES.processOutput, {
      workspaceId,
      processId: payload.processId,
      stream: payload.stream,
      text: payload.text,
    });
  }

  private handleProcessExited(workspaceId: string, status: AgentStatus, processId: string, exitCode: number): void {
    status.processes = status.processes.filter((p) => p.id !== processId);
    this.publish(workspaceId, EVENT_TYPES.processExited, { workspaceId, processId, exitCode });
  }

  private handleState(workspaceId: string, status: AgentStatus, state: AgentConnectionState, detail?: string): void {
    status.state = state;
    status.detail = detail;
    this.publish(workspaceId, EVENT_TYPES.agentState, { workspaceId, state, detail });
  }

  private publish(workspaceId: string, type: string, payload: unknown): void {
    this.hub.publish({ scope: "workspace", workspaceId, type, payload });
  }
}
