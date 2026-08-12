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
  type AgentSessionCreateRequest,
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

/**
 * Provider credential env vars the control server owns and forwards to the
 * workspace agent (V1 boundary per ADR-0010: documented, scrubbing comes
 * with the credential broker).
 */
const PROVIDER_KEY_ENV = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "TOGETHER_API_KEY",
  "PERPLEXITY_API_KEY",
] as const;

export function extractProviderEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PROVIDER_KEY_ENV) {
    const value = env[key];
    if (value) out[key] = value;
  }
  return out;
}

export class AgentManager {
  private readonly clients = new Map<string, AgentClient>();
  private readonly statuses = new Map<string, AgentStatus>();
  private readonly endpoints = new Map<string, AgentEndpoint>();

  /** Extra provider credentials (stored settings) merged at connect time. */
  credentialSource: (() => Record<string, string>) | undefined;

  constructor(
    private readonly hub: RealtimeHub,
    private readonly logger: Logger,
    /** Optional hook for session-scoped agent events (e.g. DB status sync). */
    private readonly sessionEventHook?: (sessionId: string, envelope: { type: string; payload: unknown }) => void,
  ) {}

  /** Reconnect every workspace agent so credentials re-forward at hello. */
  reconnectAll(): void {
    for (const [workspaceId, client] of this.clients) {
      client.stop();
      this.clients.delete(workspaceId);
      const endpoint = this.endpoints.get(workspaceId);
      if (endpoint) this.connect(workspaceId, endpoint);
    }
  }

  /** Start (or restart) the connection for a workspace. */
  connect(workspaceId: string, endpoint: AgentEndpoint): void {
    const existing = this.clients.get(workspaceId);
    if (existing) {
      existing.stop();
      this.clients.delete(workspaceId);
    }
    this.endpoints.set(workspaceId, endpoint);

    const status: AgentStatus = { workspaceId, state: "connecting", processes: [] };
    this.statuses.set(workspaceId, status);

    const client = new AgentClient({
      url: endpoint.url,
      token: endpoint.token,
      workspaceId,
      logger: this.logger,
      credentials: { ...extractProviderEnv(), ...(this.credentialSource?.() ?? {}) },
      events: {
        onReady: (info) => this.handleReady(workspaceId, status, info),
        onHealth: (health) => this.handleHealth(workspaceId, status, health),
        onProcessStarted: (process) => this.handleProcessStarted(workspaceId, status, process),
        onProcessOutput: (payload) => this.handleProcessOutput(workspaceId, payload),
        onProcessExited: (processId, exitCode) => this.handleProcessExited(workspaceId, status, processId, exitCode),
        onTerminalOutput: (terminalId, data) => {
          this.hub.publish({
            scope: "workspace",
            workspaceId,
            type: EVENT_TYPES.terminalOutput,
            payload: { workspaceId, terminalId, data },
          });
        },
        onTerminalClosed: (terminalId) => {
          this.hub.publish({
            scope: "workspace",
            workspaceId,
            type: EVENT_TYPES.terminalClosed,
            payload: { workspaceId, terminalId },
          });
        },
        onSessionEvent: (sessionId, envelope) => {
          this.sessionEventHook?.(sessionId, envelope);
          this.hub.publish({
            scope: "session",
            sessionId,
            type: envelope.type,
            payload: envelope.payload,
          });
        },
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

  async createSession(workspaceId: string, request: AgentSessionCreateRequest) {
    await this.waitForConnection(workspaceId);
    const event = await this.require(workspaceId).request("agent.session.create", request, 120_000);
    return event.payload as Record<string, unknown>;
  }

  async resumeSession(workspaceId: string, sessionId: string, nativeSessionPath: string) {
    const event = await this.require(workspaceId).request(
      "agent.session.resume",
      { sessionId, nativeSessionPath },
      120_000,
    );
    return event.payload as Record<string, unknown>;
  }

  async promptSession(workspaceId: string, sessionId: string, text: string): Promise<void> {
    await this.require(workspaceId).request("agent.session.prompt", { sessionId, text }, 10_000);
  }

  async steerSession(workspaceId: string, sessionId: string, text: string): Promise<void> {
    await this.require(workspaceId).request("agent.session.steer", { sessionId, text }, 10_000);
  }

  async followUpSession(workspaceId: string, sessionId: string, text: string): Promise<void> {
    await this.require(workspaceId).request("agent.session.followUp", { sessionId, text }, 10_000);
  }

  async abortSession(workspaceId: string, sessionId: string): Promise<void> {
    await this.require(workspaceId).request("agent.session.abort", { sessionId }, 10_000);
  }

  async compactSession(workspaceId: string, sessionId: string): Promise<void> {
    await this.require(workspaceId).request("agent.session.compact", { sessionId }, 10_000);
  }

  async setSessionModel(workspaceId: string, sessionId: string, model: string): Promise<void> {
    await this.require(workspaceId).request("agent.session.setModel", { sessionId, model }, 10_000);
  }

  async setSessionThinkingLevel(workspaceId: string, sessionId: string, level: string): Promise<void> {
    await this.require(workspaceId).request("agent.session.setThinkingLevel", { sessionId, level }, 10_000);
  }

  async sessionInfo(workspaceId: string, sessionId: string) {
    const event = await this.require(workspaceId).request("agent.session.info", { sessionId }, 15_000);
    return (event.payload as { info: unknown }).info;
  }

  async sessionModels(workspaceId: string) {
    const event = await this.require(workspaceId).request("agent.session.models", {}, 15_000);
    return (event.payload as { models: unknown[] }).models;
  }

  async sessionTranscript(workspaceId: string, sessionId: string, nativeSessionPath?: string, nativePiSessionId?: string) {
    const event = await this.require(workspaceId).request(
      "agent.session.transcript",
      { sessionId, nativeSessionPath, nativePiSessionId },
      30_000,
    );
    return (event.payload as { messages: unknown[] }).messages;
  }

  async disposeSession(workspaceId: string, sessionId: string): Promise<void> {
    await this.waitForConnection(workspaceId, 3_000).catch(() => undefined);
    await this.require(workspaceId).request("agent.session.dispose", { sessionId }, 10_000);
  }

  async listFiles(workspaceId: string, dir = "") {
    const event = await this.require(workspaceId).request("agent.file.list", { path: dir }, 15_000);
    return (event.payload as { entries: unknown[] }).entries;
  }

  async readFile(workspaceId: string, filePath: string, maxBytes?: number) {
    const event = await this.require(workspaceId).request("agent.file.read", { path: filePath, maxBytes }, 30_000);
    return event.payload as { content: string; encoding: "utf8" | "base64"; truncated: boolean; size: number };
  }

  async writeFile(workspaceId: string, filePath: string, content: string, encoding: "utf8" | "base64" = "utf8") {
    const event = await this.require(workspaceId).request(
      "agent.file.write",
      { path: filePath, content, encoding },
      30_000,
    );
    return event.payload as { ok: boolean; bytes?: number };
  }

  async mkdirFile(workspaceId: string, filePath: string): Promise<void> {
    await this.require(workspaceId).request("agent.file.mkdir", { path: filePath }, 15_000);
  }

  async removeFile(workspaceId: string, filePath: string, recursive = false): Promise<void> {
    await this.require(workspaceId).request("agent.file.remove", { path: filePath, recursive }, 15_000);
  }

  async renameFile(workspaceId: string, from: string, to: string): Promise<void> {
    await this.require(workspaceId).request("agent.file.rename", { from, to }, 15_000);
  }

  async searchFiles(workspaceId: string, query: string, maxResults = 50) {
    const event = await this.require(workspaceId).request("agent.file.search", { query, maxResults }, 30_000);
    return (event.payload as { matches: string[] }).matches;
  }

  async gitStatus(workspaceId: string) {
    const event = await this.require(workspaceId).request("agent.git.status", {}, 15_000);
    return event.payload;
  }

  async gitDiff(workspaceId: string, staged: boolean) {
    const event = await this.require(workspaceId).request("agent.git.diff", { staged }, 30_000);
    return event.payload;
  }

  async gitStage(workspaceId: string, paths: string[]): Promise<void> {
    await this.require(workspaceId).request("agent.git.stage", { paths }, 30_000);
  }

  async gitUnstage(workspaceId: string, paths: string[]): Promise<void> {
    await this.require(workspaceId).request("agent.git.unstage", { paths }, 30_000);
  }

  async gitCommit(workspaceId: string, message: string) {
    const event = await this.require(workspaceId).request("agent.git.commit", { message }, 30_000);
    return event.payload;
  }

  async gitBranches(workspaceId: string) {
    const event = await this.require(workspaceId).request("agent.git.branches", {}, 15_000);
    return event.payload;
  }

  async gitBranchCreate(workspaceId: string, name: string, from?: string): Promise<void> {
    await this.require(workspaceId).request("agent.git.branchCreate", { name, from }, 15_000);
  }

  async gitLog(workspaceId: string) {
    const event = await this.require(workspaceId).request("agent.git.log", { max: 30 }, 15_000);
    return event.payload;
  }

  async openTerminal(workspaceId: string, terminalId: string, cols: number, rows: number) {
    const event = await this.require(workspaceId).request(
      "agent.terminal.open",
      { id: terminalId, cols, rows },
      15_000,
    );
    return (event.payload as { terminal: unknown }).terminal;
  }

  async terminalInput(workspaceId: string, terminalId: string, data: string): Promise<void> {
    await this.require(workspaceId).request("agent.terminal.input", { id: terminalId, data }, 10_000);
  }

  async terminalResize(workspaceId: string, terminalId: string, cols: number, rows: number): Promise<void> {
    await this.require(workspaceId).request("agent.terminal.resize", { id: terminalId, cols, rows }, 10_000);
  }

  async closeTerminal(workspaceId: string, terminalId: string): Promise<void> {
    await this.require(workspaceId).request("agent.terminal.close", { id: terminalId }, 10_000);
  }

  async listTerminals(workspaceId: string) {
    const event = await this.require(workspaceId).request("agent.terminal.list", {}, 15_000);
    return (event.payload as { terminals: unknown[] }).terminals;
  }

  async listPorts(workspaceId: string) {
    const event = await this.require(workspaceId).request("agent.ports.list", {}, 15_000);
    return (event.payload as { ports: Array<{ port: number; address: string }> }).ports;
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

  /**
   * The agent inside a freshly started container needs a moment to boot and
   * for the port forward to come up; wait (bounded) for a connected client
   * before issuing the first command.
   */
  private async waitForConnection(workspaceId: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = this.statuses.get(workspaceId);
      if (status?.state === "connected") return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const client = this.clients.get(workspaceId);
    if (!client) throw new Error(`No agent connection for workspace ${workspaceId}`);
    throw new Error(`Workspace agent for ${workspaceId} is not connected yet`);
  }

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
      { workspaceId, agentVersion: info.agentVersion, processes: info.processes.length, sessions: info.sessions?.length ?? 0 },
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
