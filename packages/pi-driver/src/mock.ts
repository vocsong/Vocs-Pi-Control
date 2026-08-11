/**
 * MockPiDriver — scripted fake Pi session driver.
 *
 * Simulates streaming assistant output, thinking, tool events, usage,
 * abort and error paths without any model API calls. Most frontend and
 * integration tests must use this instead of a real provider (plan §48.1).
 */

import {
  type CreatePiSessionOptions,
  type PiDriverEvent,
  type PiDriverEventListener,
  type PiSessionDriver,
  type PiSessionHandle,
  type PiSessionSnapshot,
  type ModelRef,
  type PromptInput,
} from "./index.js";
import { newId, sleep } from "@pi-control/shared";

export interface MockPiDriverOptions {
  /** Base delay between scripted events in ms. Default 120. */
  speedMs?: number;
  /** Emit an error event after a prompt instead of completing. */
  failNextPrompt?: boolean;
}

interface MockSessionState {
  handle: PiSessionHandle;
  listeners: Set<PiDriverEventListener>;
  running: boolean;
  abortRequested: boolean;
  lastActivityAt: number;
  failNext: boolean;
}

const SCRIPT_REPLY = `I've processed your request and completed the simulated work cycle:

1. **Analyzed** the request and the current workspace state.
2. **Ran** the project test suite to establish a baseline.
3. **Reviewed** the results and summarized the findings below.

### Summary

Your request was: "%s"

Everything executed inside the workspace sandbox — no host filesystem
access was involved (this is the mock driver; the real Pi driver lands in
Phase 3). Files changed by this session are visible to other sessions in
the same workspace.`;

const THINKING_SCRIPT = [
  "The user wants me to handle a request. Let me break it down.",
  "First I should check what state the workspace is in.",
  "I'll run the test suite to get a baseline, then summarize.",
];

const ASSISTANT_SCRIPT = [
  "On it — I'll work through this step by step.",
  "I've run the baseline checks against the workspace.",
  "Here is the completed summary of what happened.",
];

export class MockPiDriver implements PiSessionDriver {
  private readonly sessions = new Map<string, MockSessionState>();
  private readonly speedMs: number;

  constructor(options: MockPiDriverOptions = {}) {
    this.speedMs = options.speedMs ?? 120;
  }

  async create(options: CreatePiSessionOptions = {}): Promise<PiSessionHandle> {
    const id = newId("mock-pi");
    const handle: PiSessionHandle = {
      id,
      status: "idle",
      model: options.model ?? "mock-model",
      thinkingLevel: options.thinkingLevel ?? "medium",
    };
    this.sessions.set(id, {
      handle,
      listeners: new Set(),
      running: false,
      abortRequested: false,
      lastActivityAt: Date.now(),
      failNext: false,
    });
    return handle;
  }

  async resume(nativeSessionIdOrPath: string): Promise<PiSessionHandle> {
    const id = newId("mock-pi");
    const handle: PiSessionHandle = {
      id,
      status: "idle",
      model: "mock-model",
      thinkingLevel: "medium",
    };
    this.sessions.set(id, {
      handle,
      listeners: new Set(),
      running: false,
      abortRequested: false,
      lastActivityAt: Date.now(),
      failNext: false,
    });
    this.emit(id, {
      type: "state",
      status: "idle",
    });
    void nativeSessionIdOrPath;
    return handle;
  }

  async prompt(sessionId: string, input: PromptInput): Promise<void> {
    const session = this.require(sessionId);
    if (session.running) {
      // Queue: the mock driver processes one prompt at a time.
      await this.waitForIdle(session);
    }
    session.running = true;
    session.abortRequested = false;
    session.lastActivityAt = Date.now();

    const userMessageId = newId("msg");
    this.emit(sessionId, {
      type: "user.message",
      messageId: userMessageId,
      content: input.text,
      createdAt: new Date().toISOString(),
    });
    this.emit(sessionId, { type: "state", status: "running" });

    await this.runScript(sessionId, input);
  }

  async steer(sessionId: string, input: PromptInput): Promise<void> {
    // Mock: identical to a fresh prompt.
    await this.prompt(sessionId, input);
  }

  async followUp(sessionId: string, input: PromptInput): Promise<void> {
    await this.prompt(sessionId, input);
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.require(sessionId);
    if (!session.running) return;
    session.abortRequested = true;
    session.running = false;
    session.handle.status = "stopped";
    this.emit(sessionId, { type: "state", status: "stopped" });
    this.emit(sessionId, { type: "closed", reason: "aborted" });
  }

  async compact(sessionId: string): Promise<void> {
    this.require(sessionId);
    // No-op in the mock.
  }

  async setModel(sessionId: string, model: ModelRef): Promise<void> {
    const session = this.require(sessionId);
    session.handle.model = model.id;
    this.emit(sessionId, { type: "model.updated", model: model.id });
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    const session = this.require(sessionId);
    session.handle.thinkingLevel = level;
  }

  async getSnapshot(sessionId: string): Promise<PiSessionSnapshot> {
    const session = this.require(sessionId);
    return {
      handle: { ...session.handle },
      lastActivityAt: session.lastActivityAt,
      usage: { tokensIn: 1234, tokensOut: 890, contextPercent: 62, costUsd: 0.0042 },
    };
  }

  async getSessionInfo(sessionId: string) {
    const session = this.require(sessionId);
    return {
      model: session.handle.model,
      thinkingLevel: session.handle.thinkingLevel,
      tools: ["read", "bash", "edit", "write"],
      skills: [],
      extensions: [],
      prompts: [],
      messages: 3,
      isStreaming: session.running,
    };
  }

  async listModels() {
    return [{ provider: "mock", id: "mock-model" }];
  }

  subscribe(sessionId: string, listener: PiDriverEventListener): () => void {
    const session = this.require(sessionId);
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }

  async dispose(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.abortRequested = true;
    session.running = false;
    this.sessions.delete(sessionId);
  }

  /* ------------------------------------------------------------------ */

  private require(sessionId: string): MockSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`MockPiDriver: unknown session ${sessionId}`);
    return session;
  }

  private emit(sessionId: string, event: PiDriverEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const listener of [...session.listeners]) {
      listener(event);
    }
  }

  private async waitForIdle(session: MockSessionState): Promise<void> {
    while (session.running) {
      await sleep(10);
    }
  }

  private async runScript(sessionId: string, input: PromptInput): Promise<void> {
    const session = this.require(sessionId);
    const d = this.speedMs;

    // Thinking section
    if (!session.abortRequested) {
      const thinkingId = newId("think");
      this.emit(sessionId, { type: "thinking.start", messageId: thinkingId });
      for (const chunk of THINKING_SCRIPT) {
        if (session.abortRequested) break;
        await sleep(d);
        this.emit(sessionId, { type: "thinking.delta", messageId: thinkingId, text: chunk });
      }
      if (!session.abortRequested) this.emit(sessionId, { type: "thinking.end", messageId: thinkingId });
    }

    // Tool call
    if (!session.abortRequested) {
      const toolCallId = newId("tool");
      this.emit(sessionId, {
        type: "tool.start",
        toolCallId,
        name: "bash",
        input: { command: "npm test" },
      });
      await sleep(d * 3);
      if (session.abortRequested) return;
      this.emit(sessionId, {
        type: "tool.update",
        toolCallId,
        output: "> pi-control@0.0.0 test\n> vitest run\n\nTest Files  1 passed (1)\nTests       3 passed (3)",
      });
      await sleep(d * 2);
      if (session.abortRequested) return;
      this.emit(sessionId, {
        type: "tool.end",
        toolCallId,
        output: "Test Files  1 passed (1)\nTests       3 passed (3)",
        durationMs: d * 5,
      });
    }

    if (session.abortRequested) return;

    // Assistant reply
    if (session.failNext) {
      session.failNext = false;
      this.emit(sessionId, { type: "error", message: "Mock provider error (simulated)" });
    } else {
      const messageId = newId("msg");
      this.emit(sessionId, { type: "assistant.start", messageId });
      const full = SCRIPT_REPLY.replace("%s", input.text.trim() || "(empty prompt)");
      // Stream in word chunks for a realistic typing effect.
      const words = full.split(/(\s+)/);
      for (const word of words) {
        if (session.abortRequested) break;
        await sleep(Math.max(1, Math.round(d / 6)));
        this.emit(sessionId, { type: "assistant.delta", messageId, text: word });
      }
      if (!session.abortRequested) this.emit(sessionId, { type: "assistant.end", messageId });
    }

    if (session.abortRequested) return;

    session.handle.status = "idle";
    session.running = false;
    session.lastActivityAt = Date.now();
    this.emit(sessionId, {
      type: "usage.updated",
      usage: {
        tokensIn: 1234 + Math.floor(Math.random() * 500),
        tokensOut: 890 + Math.floor(Math.random() * 300),
        contextPercent: Math.min(98, 62 + Math.floor(Math.random() * 10)),
        costUsd: 0.0042 + Math.random() * 0.001,
      },
    });
    this.emit(sessionId, { type: "state", status: "idle" });
  }
}
