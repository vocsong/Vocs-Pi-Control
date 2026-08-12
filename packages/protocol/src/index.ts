/**
 * Pi Control realtime protocol (browser <-> control server).
 *
 * One WebSocket connection multiplexes everything. Every server message is an
 * EventEnvelope with a monotonically increasing `seq` per control-server
 * process, enabling bounded replay after reconnect (see ADR-0007).
 *
 * Every client mutation is a ClientCommand with a request id for idempotency.
 * Command responses are themselves envelopes of type `command.ack`,
 * `command.error` or `command.duplicate`.
 */

export const PROTOCOL_VERSION = 1;

export const PROTOCOL_EVENT_VERSION = 1;

/** How many events the server keeps per replay scope (bounded replay). */
export const REPLAY_BUFFER_LIMIT = 2000;

export type Scope = "server" | "machine" | "project" | "workspace" | "session";

/**
 * Every server event. `seq` is global to the control-server process, which
 * keeps replay simple and deterministic in V1 (see ADR-0007).
 */
export interface EventEnvelope<T = unknown> {
  version: typeof PROTOCOL_EVENT_VERSION;
  seq: number;
  timestamp: number;
  scope: Scope;
  machineId?: string;
  projectId?: string;
  workspaceId?: string;
  sessionId?: string;
  type: string;
  payload: T;
}

/** Envelope fields the publisher supplies; seq/timestamp/version are added by the hub. */
export type EventEnvelopeInit<T = unknown> = Omit<EventEnvelope<T>, "seq" | "timestamp" | "version">;

export const SESSION_STATUSES = [
  "starting",
  "idle",
  "running",
  "waiting",
  "aborting",
  "stopped",
  "error",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && (SESSION_STATUSES as readonly string[]).includes(value);
}

export interface SessionInfo {
  id: string;
  workspaceId: string | null;
  title: string;
  status: SessionStatus;
  model?: string;
  thinkingLevel?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
}

export interface UsageInfo {
  tokensIn?: number;
  tokensOut?: number;
  contextPercent?: number;
  costUsd?: number;
}

/**
 * Client -> server mutation command. `id` is a client-generated request id;
 * the server deduplicates repeat submissions after reconnect.
 */
export interface ClientCommand {
  id: string;
  type: ClientCommandType;
  payload: unknown;
}

export const CLIENT_COMMAND_TYPES = [
  "session.create",
  "session.prompt",
  "session.steer",
  "session.followUp",
  "session.abort",
  "session.subscribe",
  "session.unsubscribe",
  "session.replay",
  "session.lease.take",
  "session.lease.release",
  "session.lease.heartbeat",
  "terminal.open",
  "terminal.input",
  "terminal.resize",
  "terminal.close",
  "health.ping",
] as const;

export type ClientCommandType = (typeof CLIENT_COMMAND_TYPES)[number];

export function isClientCommandType(value: unknown): value is ClientCommandType {
  return typeof value === "string" && (CLIENT_COMMAND_TYPES as readonly string[]).includes(value);
}

export function command(type: ClientCommandType, payload: unknown, id?: string): ClientCommand {
  return { id: id ?? globalThis.crypto.randomUUID(), type, payload };
}

/* ------------------------------------------------------------------ */
/* Command payloads                                                    */
/* ------------------------------------------------------------------ */

export interface CreateSessionPayload {
  title?: string;
  model?: string;
  thinkingLevel?: string;
}

export interface PromptPayload {
  sessionId: string;
  text: string;
}

export interface AbortPayload {
  sessionId: string;
}

export interface SubscribePayload {
  sessionId: string;
  /** Replay events after this sequence number, if available. */
  lastSeq: number;
}

export interface UnsubscribePayload {
  sessionId: string;
}

export interface ReplayPayload {
  lastSeq: number;
}

export interface LeasePayload {
  sessionId: string;
}

/* ------------------------------------------------------------------ */
/* Editing lease (plan §27)                                            */
/* ------------------------------------------------------------------ */

export interface LeaseInfo {
  sessionId: string;
  holder: string | null;
  expiresAt: number | null;
  /** True when the holder is the socket that requested the status. */
  isSelf?: boolean;
}

export interface LeaseEventPayload extends LeaseInfo {}

export interface SnapshotPayload {
  sessionId: string;
  session: SessionInfo;
  reason: "replay_gap" | "server_restart";
}

/* ------------------------------------------------------------------ */
/* Event payloads                                                      */
/* ------------------------------------------------------------------ */

export interface SessionEventPayload {
  sessionId: string;
  session: SessionInfo;
}

export interface SessionStatePayload {
  sessionId: string;
  status: SessionStatus;
}

export interface MessageEventPayload {
  sessionId: string;
  messageId: string;
  content?: string;
  createdAt?: string;
}

export interface ToolEventPayload {
  sessionId: string;
  toolCallId: string;
  name?: string;
  input?: unknown;
  output?: string;
  durationMs?: number;
  error?: string;
}

export interface UsageEventPayload {
  sessionId: string;
  usage: UsageInfo;
}

export interface ModelUpdatedPayload {
  sessionId: string;
  model: string;
}

export interface ErrorEventPayload {
  sessionId?: string;
  message: string;
}

export interface ClosedEventPayload {
  sessionId: string;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Project / workspace / sandbox payloads                              */
/* ------------------------------------------------------------------ */

export type SandboxStatus =
  | "missing"
  | "building"
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface WorkspaceInfo {
  id: string;
  machineId: string;
  name: string;
  hostRootPath: string;
  gitRepositoryRoot?: string;
  createdAt: string;
  lastOpenedAt?: string;
}

export interface SandboxInfo {
  id: string;
  workspaceId: string;
  machineId: string;
  name: string;
  hostPath: string;
  containerWorkspacePath: string;
  kind: "main" | "worktree" | "directory";
  gitBranch?: string;
  securityProfile: "standard" | "restricted" | "trusted";
  status: SandboxStatus;
  /** Host loopback start of this sandbox's published dev-port range. */
  devHostStart?: number;
  /** Host loopback end (inclusive) of the published dev-port range. */
  devHostEnd?: number;
  createdAt: string;
  archivedAt?: string;
}

export interface SandboxStatusPayload {
  runtime: string;
  detected: boolean;
  rootlessAvailable: boolean;
  machineRequired: boolean;
  machineConfigured: boolean;
  machineRunning: boolean;
  version?: string;
  messages: string[];
}

export interface PrepareEventPayload {
  phase: "started" | "progress" | "complete" | "error";
  message?: string;
  ok?: boolean;
}

export interface SelfTestEventPayload {
  phase: "started" | "check" | "complete" | "error";
  checkName?: string;
  checkOk?: boolean;
  detail?: string;
  ok?: boolean;
}

/* ------------------------------------------------------------------ */
/* Agent / process payloads (browser-facing)                           */
/* ------------------------------------------------------------------ */

export type AgentState = "connecting" | "connected" | "disconnected";

export interface AgentStatePayload {
  workspaceId: string;
  state: AgentState;
  agentVersion?: string;
  detail?: string;
}

export interface ProcessInfo {
  id: string;
  workspaceId: string;
  name: string;
  command: string;
  cwd: string;
  status: "starting" | "running" | "exited" | "error";
  pid?: number;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number;
}

export interface ProcessOutputPayload {
  workspaceId: string;
  processId: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface ProcessExitedPayload {
  workspaceId: string;
  processId: string;
  exitCode: number;
}

export interface TerminalInfo {
  id: string;
  workspaceId: string;
  shell: string;
  cols: number;
  rows: number;
  openedAt: string;
  buffer: string;
}

export interface TerminalOutputPayload {
  workspaceId: string;
  terminalId: string;
  data: string;
}

export interface TerminalClosedPayload {
  workspaceId: string;
  terminalId: string;
}

export type TaskStatus = "todo" | "running" | "blocked" | "done" | "failed";

export interface TaskInfo {
  id: string;
  workspaceId: string;
  parentTaskId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignedSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEventPayload {
  task: TaskInfo;
}

/* ------------------------------------------------------------------ */
/* Event types                                                         */
/* ------------------------------------------------------------------ */

export const EVENT_TYPES = {
  sessionCreated: "session.created",
  sessionUpdated: "session.updated",
  sessionState: "session.state",
  sessionSnapshot: "session.snapshot",
  sessionLease: "session.lease",
  sessionError: "session.error",
  sessionClosed: "session.closed",

  userMessage: "user.message",
  assistantStart: "assistant.start",
  assistantDelta: "assistant.delta",
  assistantEnd: "assistant.end",
  thinkingStart: "thinking.start",
  thinkingDelta: "thinking.delta",
  thinkingEnd: "thinking.end",

  toolStart: "tool.start",
  toolUpdate: "tool.update",
  toolEnd: "tool.end",
  toolError: "tool.error",

  modelUpdated: "model.updated",
  usageUpdated: "usage.updated",

  workspaceCreated: "workspace.created",
  sandboxCreated: "sandbox.created",
  sandboxState: "sandbox.state",
  sandboxError: "sandbox.error",
  sandboxStatus: "sandbox.status",
  sandboxPrepare: "sandbox.prepare",
  sandboxSelfTest: "sandbox.selftest",

  agentState: "agent.state",
  agentHealth: "agent.health",
  processStarted: "process.started",
  processOutput: "process.output",
  processExited: "process.exited",
  taskCreated: "task.created",
  taskUpdated: "task.updated",
  terminalCreated: "terminal.created",
  terminalOutput: "terminal.output",
  terminalClosed: "terminal.closed",

  commandAck: "command.ack",
  commandError: "command.error",
  commandDuplicate: "command.duplicate",
  replayComplete: "replay.complete",
  serverHello: "server.hello",
} as const;

export interface CommandAckPayload {
  commandId: string;
  lastSeq: number;
}

export interface CommandErrorPayload {
  commandId: string;
  message: string;
}

export interface ReplayCompletePayload {
  lastSeq: number;
}

/* ------------------------------------------------------------------ */
/* Typed constructors for common envelopes                             */
/* ------------------------------------------------------------------ */

export function sessionEnvelope(
  sessionId: string,
  type: string,
  payload: unknown,
): EventEnvelopeInit {
  return { scope: "session", sessionId, type, payload };
}

export * from "./agent.js";
