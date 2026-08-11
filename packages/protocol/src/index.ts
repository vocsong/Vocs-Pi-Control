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
  "session.abort",
  "session.subscribe",
  "session.unsubscribe",
  "session.replay",
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
/* Event types                                                         */
/* ------------------------------------------------------------------ */

export const EVENT_TYPES = {
  sessionCreated: "session.created",
  sessionState: "session.state",
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

  commandAck: "command.ack",
  commandError: "command.error",
  commandDuplicate: "command.duplicate",
  replayComplete: "replay.complete",
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
