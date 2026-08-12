/**
 * EmbeddedPiDriver — real Pi integration via the official SDK
 * (createAgentSession), running INSIDE the workspace agent (plan §3.1,
 * ADR-0004).
 *
 * The pi package is ESM-only and loaded lazily via a runtime import() so
 * the CJS agent bundle can keep `ws` bundled while resolving pi from
 * node_modules at runtime (installed in the base image).
 */

import {
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  type CreatePiSessionOptions,
  type ModelRef,
  type PiDriverEvent,
  type PiDriverEventListener,
  type PiSessionDriver,
  type PiSessionHandle,
  type PiSessionSnapshot,
  type PromptInput,
  type TranscriptMessage,
} from "./index.js";
import { newId } from "@pi-control/shared";

/** Best-effort JSON.parse for tool args delivered as strings. */
function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export interface EmbeddedPiDriverOptions {
  /** Working directory for Pi (the workspace mount). */
  cwd?: string;
  /** Pi agent directory (sandbox-scoped, persistent volume). */
  agentDir?: string;
  /** Session directory for native session persistence. */
  sessionDir?: string;
  /** Provider credential env vars to expose to Pi (V1 boundary, ADR-0010). */
  credentials?: Record<string, string>;
}

interface PiModule {
  createAgentSession(options: Record<string, unknown>): Promise<{
    session: AgentSession;
    extensionsResult?: { extensions: Array<{ name?: string }>; errors: unknown[] };
    modelFallbackMessage?: string;
  }>;
  ModelRuntime: {
    create(options?: Record<string, unknown>): Promise<{
      getModel(provider: string, id: string): unknown;
      getAvailable(): Promise<Array<{ id: string; provider: string | { id?: string } }>>;
    }>;
  };
  SessionManager: {
    inMemory(cwd?: string): unknown;
    create(cwd: string): unknown;
    open(path: string): unknown;
    continueRecent(cwd: string): unknown;
  };
  DefaultResourceLoader: new (options?: Record<string, unknown>) => {
    reload(): Promise<void>;
    getSkills(): { skills: Array<{ name: string }>; diagnostics: unknown[] };
    getPrompts(): { prompts: Array<{ name: string }>; diagnostics: unknown[] };
  };
}

interface ManagedSession {
  session: AgentSession;
  listeners: Set<PiDriverEventListener>;
  currentAssistantMessageId: string | null;
  /** Set while a text-bearing assistant message is streaming. */
  textMessageOpen: boolean;
  currentToolId: string | null;
  /** Capability visibility captured at creation (Phase 9). */
  tools: string[];
  skills: string[];
  extensions: string[];
  prompts: string[];
}

// Injected by CJS bundlers (esbuild); undefined under tsx/ESM dev runs.
declare const __dirname: string | undefined;

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/**
 * Import the pi package.
 *
 * The CJS agent bundle cannot `import()` the bare specifier (ESM resolution
 * ignores NODE_PATH, and require.resolve cannot resolve ESM-only exports), so
 * in bundle mode we locate the package directory manually (NODE_PATH entries,
 * node_modules walk from the bundle, fixed image path) and import its entry
 * file directly. Under tsx/ESM dev runs a plain `import()` works.
 */
async function importPi(): Promise<PiModule> {
  if (typeof __dirname !== "string") {
    return (await import(PI_PACKAGE)) as PiModule;
  }
  const candidates: string[] = [];
  for (const entry of (process.env.NODE_PATH ?? "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(entry, PI_PACKAGE));
  }
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    dir = path.dirname(dir);
    candidates.push(path.join(dir, "node_modules", PI_PACKAGE));
  }
  candidates.push(path.join("/opt/pi-control/node_modules", PI_PACKAGE));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, "package.json"))) {
        return (await import(pathToFileURL(path.join(candidate, "dist", "index.js")).href)) as PiModule;
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `Cannot locate package ${PI_PACKAGE} (NODE_PATH=${process.env.NODE_PATH ?? "<unset>"}; tried ${candidates.length} locations)`,
  );
}

export class EmbeddedPiDriver implements PiSessionDriver {
  private readonly sessions = new Map<string, ManagedSession>();
  private pi: PiModule | null = null;
  private modelRuntime: Awaited<ReturnType<PiModule["ModelRuntime"]["create"]>> | null = null;
  private piLoadError: string | null = null;

  constructor(private readonly options: EmbeddedPiDriverOptions = {}) {}

  private async piModule(): Promise<PiModule> {
    if (this.pi) return this.pi;
    if (this.piLoadError) throw new Error(this.piLoadError);
    try {
      const mod = await importPi();
      this.pi = mod;
      const credentials = this.options.credentials;
      if (credentials) {
        for (const [key, value] of Object.entries(credentials)) {
          if (value) process.env[key] = value;
        }
      }
      this.modelRuntime = await mod.ModelRuntime.create();
      return mod;
    } catch (error) {
      this.piLoadError = `Pi SDK unavailable: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(this.piLoadError);
    }
  }

  async create(options: CreatePiSessionOptions = {}): Promise<PiSessionHandle> {
    const pi = await this.piModule();
    const cwd = this.options.cwd ?? "/workspace";
    const sessionId = newId("pi");
    const model = await this.resolveModel(options.model);

    // Build our own resource loader so capabilities can be surfaced
    // (skills, prompts, extensions) — read-only visibility (plan §34).
    const loader = new pi.DefaultResourceLoader({
      cwd,
      agentDir: this.options.agentDir ?? "/state/pi-agent",
    });
    await loader.reload();

    const result = await pi.createAgentSession({
      cwd,
      agentDir: this.options.agentDir ?? "/state/pi-agent",
      sessionManager: pi.SessionManager.create(cwd),
      modelRuntime: this.modelRuntime,
      resourceLoader: loader,
      ...(model ? { model } : {}),
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
    });

    const managed: ManagedSession = {
      session: result.session,
      listeners: new Set(),
      currentAssistantMessageId: null,
      textMessageOpen: false,
      currentToolId: null,
      tools: [],
      skills: (loader.getSkills() as { skills: Array<{ name: string }> }).skills.map((s) => s.name).filter(Boolean),
      extensions: (result.extensionsResult?.extensions ?? []).map((e) => e.name ?? "<inline>").filter(Boolean),
      prompts: (loader.getPrompts() as { prompts: Array<{ name: string }> }).prompts.map((p) => p.name).filter(Boolean),
    };
    this.sessions.set(sessionId, managed);
    result.session.subscribe((event) => this.dispatch(sessionId, event));

    this.emit(sessionId, { type: "state", status: "idle" });
    if (model) this.emit(sessionId, { type: "model.updated", model: model.id });

    return {
      id: sessionId,
      nativePiSessionId: result.session.sessionId,
      sessionFile: result.session.sessionFile,
      status: "idle",
      model: modelRef(model) ?? modelRef(result.session.model),
      thinkingLevel: options.thinkingLevel ?? result.session.thinkingLevel,
    };
  }

  async resume(nativeSessionIdOrPath: string): Promise<PiSessionHandle> {
    const pi = await this.piModule();
    const sessionId = newId("pi");
    const result = await pi.createAgentSession({
      cwd: this.options.cwd ?? "/workspace",
      agentDir: this.options.agentDir ?? "/state/pi-agent",
      sessionManager: pi.SessionManager.open(nativeSessionIdOrPath),
      modelRuntime: this.modelRuntime,
    });
    const managed: ManagedSession = {
      session: result.session,
      listeners: new Set(),
      currentAssistantMessageId: null,
      textMessageOpen: false,
      currentToolId: null,
      tools: [],
      skills: [],
      extensions: [],
      prompts: [],
    };
    this.sessions.set(sessionId, managed);
    result.session.subscribe((event) => this.dispatch(sessionId, event));
    this.emit(sessionId, { type: "state", status: "idle" });
    return {
      id: sessionId,
      nativePiSessionId: result.session.sessionId,
      sessionFile: result.session.sessionFile,
      status: "idle",
      model: modelRef(result.session.model),
      thinkingLevel: result.session.thinkingLevel,
    };
  }

  async prompt(sessionId: string, input: PromptInput): Promise<void> {
    const managed = this.require(sessionId);
    if (managed.session.isStreaming) {
      // Pi requires explicit queueing during streaming: queue as follow-up.
      await managed.session.followUp(input.text);
      return;
    }
    await managed.session.prompt(input.text);
  }

  async steer(sessionId: string, input: PromptInput): Promise<void> {
    const managed = this.require(sessionId);
    await managed.session.steer(input.text);
  }

  async followUp(sessionId: string, input: PromptInput): Promise<void> {
    const managed = this.require(sessionId);
    await managed.session.followUp(input.text);
  }

  async abort(sessionId: string): Promise<void> {
    const managed = this.require(sessionId);
    await managed.session.abort();
    this.emit(sessionId, { type: "state", status: "stopped" });
    this.emit(sessionId, { type: "closed", reason: "aborted" });
  }

  async compact(sessionId: string): Promise<void> {
    const managed = this.require(sessionId);
    await managed.session.compact();
  }

  async setModel(sessionId: string, model: ModelRef): Promise<void> {
    const managed = this.require(sessionId);
    const resolved = await this.resolveModel(model.id);
    if (!resolved) throw new Error(`Model not found: ${model.id}`);
    await managed.session.setModel(resolved as Parameters<AgentSession["setModel"]>[0]);
    this.emit(sessionId, { type: "model.updated", model: model.id });
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    const managed = this.require(sessionId);
    managed.session.setThinkingLevel(level as Parameters<AgentSession["setThinkingLevel"]>[0]);
  }

  async getSnapshot(sessionId: string): Promise<PiSessionSnapshot> {
    const managed = this.require(sessionId);
    const session = managed.session;
    return {
      handle: {
        id: sessionId,
        nativePiSessionId: session.sessionId,
        status: session.isStreaming ? "running" : "idle",
        model: session.model?.id,
        thinkingLevel: session.thinkingLevel,
      },
      lastActivityAt: Date.now(),
      usage: { tokensIn: session.agent.state.messages.length },
    };
  }

  async getSessionInfo(sessionId: string) {
    const managed = this.require(sessionId);
    const session = managed.session;
    return {
      model: session.model?.id,
      thinkingLevel: session.thinkingLevel,
      tools: session.agent.state.tools.map((t) => t.name).filter(Boolean),
      skills: managed.skills,
      extensions: managed.extensions,
      prompts: managed.prompts,
      messages: session.messages.length,
      isStreaming: session.isStreaming,
      sessionFile: session.sessionFile,
    };
  }

  async readTranscript(sessionId: string) {
    const managed = this.require(sessionId);
    return mapMessages(managed.session.messages as unknown as Array<Record<string, unknown>>);
  }

  async listModels() {
    const pi = await this.piModule();
    if (!this.modelRuntime) return [];
    const available = await this.modelRuntime.getAvailable();
    // pi returns provider as a STRING ("deepseek") — never "unknown".
    return available
      .map((m) => ({ provider: typeof m.provider === "string" ? m.provider : (m.provider?.id ?? "unknown"), id: m.id ?? "" }))
      .filter((m) => m.id);
  }

  subscribe(sessionId: string, listener: PiDriverEventListener): () => void {
    const managed = this.require(sessionId);
    managed.listeners.add(listener);
    return () => {
      managed.listeners.delete(listener);
    };
  }

  async dispose(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    managed.session.dispose();
    this.sessions.delete(sessionId);
  }

  /* ------------------------------------------------------------------ */

  private require(sessionId: string): ManagedSession {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`EmbeddedPiDriver: unknown session ${sessionId}`);
    return managed;
  }

  private emit(sessionId: string, event: PiDriverEvent): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    for (const listener of [...managed.listeners]) listener(event);
  }

  private async resolveModel(ref: string | undefined): Promise<{ id: string } | undefined> {
    if (!ref || !this.modelRuntime) return undefined;
    const [provider, id] = ref.split("/");
    if (!provider || !id) return undefined;
    const direct = this.modelRuntime.getModel(provider, id) as { id: string } | undefined;
    if (direct) return direct;
    // Fallback: match by model id in the available catalog (handles stale
    // refs saved under the old "unknown/<id>" provider label).
    const available = await this.modelRuntime.getAvailable();
    return available.find((m) => m.id === id || `${typeof m.provider === "string" ? m.provider : m.provider?.id}/${m.id}` === ref) as { id: string } | undefined;
  }

  private dispatch(sessionId: string, event: AgentSessionEvent): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    const idFor = (): string => managed.currentAssistantMessageId ?? "msg";

    switch (event.type) {
      case "agent_start":
        this.emit(sessionId, { type: "state", status: "running" });
        return;
      case "agent_end":
      case "agent_settled":
        this.emit(sessionId, { type: "state", status: "idle" });
        return;
      case "message_start": {
        const role = (event as { message?: { role?: string } }).message?.role;
        if (role === "assistant") {
          managed.currentAssistantMessageId = (event as { message?: { id?: string } }).message?.id ?? newId("msg");
        }
        return;
      }
      case "message_update": {
        const update = event.assistantMessageEvent;
        switch (update.type) {
          case "text_start": {
            // The text phase of an assistant message begins; thinking and
            // tool-call segments are separate messages and must not open
            // or close the UI stream.
            managed.currentAssistantMessageId = (event as { messageId?: string }).messageId ?? managed.currentAssistantMessageId ?? newId("msg");
            managed.textMessageOpen = true;
            this.emit(sessionId, { type: "assistant.start", messageId: idFor() });
            return;
          }
          case "text_delta":
            if (!managed.textMessageOpen) {
              managed.currentAssistantMessageId = (event as { messageId?: string }).messageId ?? managed.currentAssistantMessageId ?? newId("msg");
              managed.textMessageOpen = true;
              this.emit(sessionId, { type: "assistant.start", messageId: idFor() });
            }
            this.emit(sessionId, { type: "assistant.delta", messageId: idFor(), text: update.delta });
            return;
          case "text_end":
            this.emit(sessionId, { type: "assistant.end", messageId: idFor() });
            managed.textMessageOpen = false;
            return;
          case "thinking_start":
            this.emit(sessionId, { type: "thinking.start", messageId: idFor() });
            return;
          case "thinking_delta":
            this.emit(sessionId, { type: "thinking.delta", messageId: idFor(), text: update.delta });
            return;
          case "thinking_end":
            this.emit(sessionId, { type: "thinking.end", messageId: idFor() });
            return;
          default:
            // toolcall_start/delta/end and other announcements: the actual
            // executions arrive as tool_execution_* events.
            return;
        }
      }
      case "message_end": {
        return; // text_end closes the UI stream; message_end fires per segment
      }
      case "tool_execution_start": {
        const toolCallId = (event as { toolCallId?: string }).toolCallId ?? newId("tool");
        managed.currentToolId = toolCallId;
        const rawArgs = (event as { args?: unknown }).args;
        this.emit(sessionId, {
          type: "tool.start",
          toolCallId,
          name: event.toolName,
          input: rawArgs === undefined ? undefined : typeof rawArgs === "string" ? safeParseJson(rawArgs) ?? rawArgs : rawArgs,
        });
        return;
      }
      case "tool_execution_update": {
        const output = (event as { output?: unknown }).output;
        this.emit(sessionId, {
          type: "tool.update",
          toolCallId: managed.currentToolId ?? newId("tool"),
          output: typeof output === "string" ? output : output === undefined ? undefined : JSON.stringify(output),
        });
        return;
      }
      case "tool_execution_end": {
        const toolCallId = managed.currentToolId ?? newId("tool");
        if (event.isError) {
          this.emit(sessionId, {
            type: "tool.error",
            toolCallId,
            error: typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? {}),
          });
        } else {
          this.emit(sessionId, {
            type: "tool.end",
            toolCallId,
            output: typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? {}),
            durationMs: 0,
          });
        }
        return;
      }
      default:
        return;
    }
  }
}

/** Map native Pi AgentMessages to display-oriented TranscriptMessages. */
function mapMessages(messages: Array<Record<string, unknown>>): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  for (const message of messages) {
    const role = String(message.role ?? "");
    const content = (message.content ?? []) as Array<Record<string, unknown>>;
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    for (const item of content) {
      const type = String(item.type ?? "");
      if (type === "text" && typeof item.text === "string") textParts.push(item.text);
      else if (type === "thinking" && typeof item.thinking === "string") thinkingParts.push(item.thinking);
    }
    const toolName = typeof message.toolName === "string" ? message.toolName : undefined;
    if (role === "user") {
      out.push({ role: "user", text: textParts.join("\n"), timestamp: stringOr(message.timestamp) });
    } else if (role === "assistant") {
      out.push({
        role: "assistant",
        text: textParts.join("\n") || undefined,
        thinking: thinkingParts.join("\n") || undefined,
        timestamp: stringOr(message.timestamp),
      });
    } else if (role === "toolResult" || role === "tool") {
      out.push({
        role: "tool",
        toolName,
        toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
        output: textParts.join("\n") || undefined,
        timestamp: stringOr(message.timestamp),
      });
    }
  }
  return out;
}

function stringOr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Model refs are stored QUALIFIED (provider/id) so they are always
 * comparable with the catalog (plan §34). */
function modelRef(model: { provider?: string; id?: string } | undefined): string | undefined {
  if (!model?.id) return undefined;
  const provider = typeof model.provider === "string" && model.provider ? model.provider : "unknown";
  return `${provider}/${model.id}`;
}
