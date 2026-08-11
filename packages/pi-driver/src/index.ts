/**
 * Pi session driver abstraction.
 *
 * Isolates upstream Pi APIs (SDK embedding, RPC subprocess, ...) behind a
 * local interface so neither the control server nor the browser depends on
 * which Pi driver is used (see ADR-0004). The first implementation is
 * `MockPiDriver`; `EmbeddedPiDriver` (official Pi SDK) follows in Phase 3.
 */

import type { SessionStatus, UsageInfo } from "@pi-control/protocol";

export interface ModelRef {
  id: string;
  provider?: string;
  label?: string;
}

export interface CreatePiSessionOptions {
  title?: string;
  model?: string;
  thinkingLevel?: string;
}

export interface PromptInput {
  text: string;
  attachments?: unknown[];
  model?: string;
  thinkingLevel?: string;
}

/** Stable identifier of a running Pi session inside the driver. */
export interface PiSessionHandle {
  id: string;
  /** Native Pi session id when a native session exists (Phase 3+). */
  nativePiSessionId?: string;
  status: SessionStatus;
  model?: string;
  thinkingLevel?: string;
}

export interface PiSessionSnapshot {
  handle: PiSessionHandle;
  lastActivityAt?: number;
  usage?: UsageInfo;
}

/* ------------------------------------------------------------------ */
/* Driver events (normalized, upstream-agnostic)                       */
/* ------------------------------------------------------------------ */

export type PiDriverEvent =
  | { type: "user.message"; messageId: string; content: string; createdAt: string }
  | { type: "assistant.start"; messageId: string }
  | { type: "assistant.delta"; messageId: string; text: string }
  | { type: "assistant.end"; messageId: string }
  | { type: "thinking.start"; messageId: string }
  | { type: "thinking.delta"; messageId: string; text: string }
  | { type: "thinking.end"; messageId: string }
  | { type: "tool.start"; toolCallId: string; name: string; input: unknown }
  | { type: "tool.update"; toolCallId: string; output?: string }
  | { type: "tool.end"; toolCallId: string; output: string; durationMs: number }
  | { type: "tool.error"; toolCallId: string; error: string }
  | { type: "state"; status: SessionStatus }
  | { type: "model.updated"; model: string }
  | { type: "usage.updated"; usage: UsageInfo }
  | { type: "error"; message: string }
  | { type: "closed"; reason: string };

export type PiDriverEventListener = (event: PiDriverEvent) => void;

export interface PiSessionDriver {
  create(options: CreatePiSessionOptions): Promise<PiSessionHandle>;
  resume(nativeSessionIdOrPath: string): Promise<PiSessionHandle>;

  prompt(sessionId: string, input: PromptInput): Promise<void>;
  steer(sessionId: string, input: PromptInput): Promise<void>;
  followUp(sessionId: string, input: PromptInput): Promise<void>;
  abort(sessionId: string): Promise<void>;

  compact(sessionId: string): Promise<void>;

  setModel(sessionId: string, model: ModelRef): Promise<void>;
  setThinkingLevel(sessionId: string, level: string): Promise<void>;

  getSnapshot(sessionId: string): Promise<PiSessionSnapshot>;

  subscribe(sessionId: string, listener: PiDriverEventListener): () => void;

  dispose(sessionId: string): Promise<void>;
}

/** Driver factory used by the session supervisor. */
export type PiDriverFactory = () => PiSessionDriver;
