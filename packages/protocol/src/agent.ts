/**
 * Workspace-agent protocol (control server <-> pi-control-workspace-agent).
 *
 * The control server connects OUT to the agent: the workspace container
 * publishes `127.0.0.1:<hostPort>:<agentPort>` at creation, and the agent
 * listens on the agent port inside the sandbox (plan §11.3, ADR-0006).
 * Authentication is a random per-sandbox token presented as
 * `Authorization: Bearer <token>` on the WebSocket upgrade; the server
 * rejects connections without a valid token before any message is read.
 *
 * The agent is the process/terminal/session owner inside the sandbox and
 * survives control-server restarts; the server reconnects and re-syncs.
 */

export const AGENT_PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Server -> agent commands                                            */
/* ------------------------------------------------------------------ */

export const AGENT_COMMAND_TYPES = [
  "agent.hello",
  "agent.ping",
  "agent.exec",
  "agent.process.spawn",
  "agent.process.kill",
  "agent.process.list",
  "agent.shutdown",
] as const;

export type AgentCommandType = (typeof AGENT_COMMAND_TYPES)[number];

export interface AgentCommand<T = unknown> {
  id: string;
  type: AgentCommandType;
  payload: T;
}

export interface AgentHelloPayload {
  workspaceId: string;
  agentVersion: string;
  protocolVersion: number;
}

export interface AgentExecRequest {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface AgentProcessSpawnRequest {
  name?: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Agent -> server events                                              */
/* ------------------------------------------------------------------ */

export const AGENT_EVENT_TYPES = [
  "agent.ready",
  "agent.health",
  "agent.ok",
  "agent.exec.output",
  "agent.exec.exit",
  "agent.process.started",
  "agent.process.output",
  "agent.process.exited",
  "agent.process.list",
  "agent.error",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export interface AgentEvent<T = unknown> {
  type: AgentEventType;
  payload: T;
}

export interface AgentReadyPayload {
  workspaceId: string;
  agentVersion: string;
  protocolVersion: number;
  processes: AgentProcessInfo[];
}

export interface AgentHealthPayload {
  workspaceId: string;
  uptimeMs: number;
  memory: { rssBytes: number; heapUsedBytes: number };
  cpuPercent?: number;
  processCount: number;
  agentVersion: string;
}

export interface AgentProcessInfo {
  id: string;
  name: string;
  command: string;
  cwd: string;
  status: "starting" | "running" | "exited" | "error";
  pid?: number;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number;
}

export interface AgentExecOutputPayload {
  commandId: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface AgentExecExitPayload {
  commandId: string;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  stdout: string;
  stderr: string;
}

export interface AgentProcessStartedPayload {
  process: AgentProcessInfo;
  /** Present when this event is the response to an agent.process.spawn command. */
  commandId?: string;
}

export interface AgentOkPayload {
  commandId: string;
}

export interface AgentProcessOutputPayload {
  processId: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface AgentProcessExitedPayload {
  processId: string;
  exitCode: number;
}

export interface AgentProcessListPayload {
  processes: AgentProcessInfo[];
  /** Present when this event is the response to an agent.process.list command. */
  commandId?: string;
}

export interface AgentErrorPayload {
  message: string;
  commandId?: string;
}
