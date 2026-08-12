import { create } from "zustand";
import type {
  EventEnvelope,
  SandboxInfo,
  SessionInfo,
  UsageInfo,
  WorkspaceInfo,
} from "@pi-control/protocol";
import { EVENT_TYPES } from "@pi-control/protocol";
import { api } from "./api";

export type ChatItem =
  | { kind: "user"; messageId: string; content: string; createdAt: string; ts?: number }
  | { kind: "assistant"; messageId: string; text: string; streaming: boolean; ts?: number }
  | { kind: "thinking"; messageId: string; text: string; done: boolean; open: boolean; ts?: number }
  | {
      kind: "tool";
      toolCallId: string;
      name: string;
      input?: unknown;
      output?: string;
      durationMs?: number;
      status: "running" | "done" | "error";
      error?: string;
      ts?: number;
    }
  | { kind: "system"; text: string; tone: "info" | "error" };

export interface SandboxStatusInfo {
  runtime: string;
  detected: boolean;
  rootlessAvailable: boolean;
  machineRequired: boolean;
  machineConfigured: boolean;
  machineRunning: boolean;
  version?: string;
  messages: string[];
}

export interface SelfTestCheckInfo {
  name: string;
  ok: boolean;
  detail: string;
}

interface PiControlState {
  connection: "connecting" | "open" | "closed" | "unauthorized";
  /** null = unknown (check in flight); false = login gate shown. */
  authenticated: boolean | null;
  sessions: Record<string, SessionInfo>;
  sessionOrder: string[];
  items: Record<string, ChatItem[]>;
  usage: Record<string, UsageInfo>;
  activeSessionId: string | null;
  lastSeq: number;
  /** Client id announced by the server (server.hello) — lease comparison. */
  clientId: string | null;
  /** Editing leases per session (plan §27). */
  leases: Record<string, { holder: string | null; expiresAt: number | null }>;
  /** Workspaces (folders) / sandboxes (containers) hierarchy. */
  workspaces: Record<string, WorkspaceInfo>;
  workspaceOrder: string[];
  sandboxes: Record<string, SandboxInfo>;
  sandboxOrder: string[];
  /** Selected workspace (folder) / sandbox (container) for navigation. */
  activeWorkspaceId: string | null;
  activeSandboxId: string | null;
  /** Sandbox runtime status (Phase 1). */
  sandbox: SandboxStatusInfo | null;
  sandboxBusy: boolean;
  selfTest: SelfTestCheckInfo[] | null;
  /** Quick-open target: a workspace-relative path to open in the Files tab. */
  requestedFile: string | null;
  /** True while the server replays buffered events after (re)subscribe. */
  replaying: boolean;
  /** Verbose envelope log (bounded) for troubleshooting (LOG tab). */
  log: Array<{ seq: number; ts: number; type: string; scope: string; sessionId?: string; payload: unknown }>;
  /** Keep completed thinking blocks expanded (settings → session defaults). */
  showThinkingByDefault: boolean;

  /** Load settings that affect chat rendering (session defaults). */
  loadSettings(): Promise<void>;
  setShowThinkingByDefault(value: boolean): void;
  setConnection(connection: PiControlState["connection"]): void;
  setAuthenticated(authenticated: boolean): void;
  setActive(sessionId: string | null): void;
  setActiveWorkspace(workspaceId: string | null): void;
  setActiveSandbox(sandboxId: string | null): void;
  /** Select a workspace and jump to its most recently used session. */
  selectWorkspace(workspaceId: string): void;
  createSession(): Promise<void>;
  createWorkspaceSession(workspaceId: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  createWorkspace(name: string, hostRootPath?: string): Promise<void>;
  createSandbox(name?: string, hostPath?: string): Promise<void>;
  startSandbox(sandboxId: string): Promise<void>;
  stopSandbox(sandboxId: string): Promise<void>;
  removeSandbox(sandboxId: string): Promise<void>;
  startWorkspaceFlow(workspaceId: string): Promise<void>;
  stopWorkspaceFlow(workspaceId: string): Promise<void>;
  prepareSandbox(): Promise<void>;
  runSelfTest(): Promise<void>;
  setRequestedFile(path: string | null): void;
  clearLog(): void;
  apply(envelope: EventEnvelope): void;
}

function appendOrder(order: string[], id: string): string[] {
  return order.includes(id) ? order : [...order, id];
}

export const usePiControl = create<PiControlState>((set, get) => ({
  connection: "closed",
  authenticated: null,
  sessions: {},
  sessionOrder: [],
  items: {},
  usage: {},
  activeSessionId: null,
  lastSeq: 0,
  clientId: null,
  leases: {},
  workspaces: {},
  workspaceOrder: [],
  sandboxes: {},
  sandboxOrder: [],
  activeWorkspaceId: null,
  activeSandboxId: null,
  sandbox: null,
  sandboxBusy: false,
  selfTest: null,
  requestedFile: null,
  replaying: false,
  log: [],
  showThinkingByDefault: false,

  setConnection: (connection) =>
    set(
      connection === "unauthorized"
        ? { connection, authenticated: false }
        : { connection },
    ),
  setAuthenticated: (authenticated) => set({ authenticated }),
  setActive: (activeSessionId) => set({ activeSessionId }),
  setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setActiveSandbox: (activeSandboxId) => set({ activeSandboxId }),

  selectWorkspace: (workspaceId) => {
    const state = get();
    const sandbox = Object.values(state.sandboxes).find((sb) => sb.workspaceId === workspaceId);
    set({ activeWorkspaceId: workspaceId, activeSandboxId: sandbox?.id ?? null });
    if (!sandbox) return;
    const latest = Object.values(state.sessions)
      .filter((sess) => sess.workspaceId === sandbox.id)
      .sort((a, b) => (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt));
    if (latest[0]) set({ activeSessionId: latest[0].id });
  },

  createSession: async () => {
    // REAL Pi sessions only — they run inside a sandbox. Prefer the
    // SELECTED workspace's sandbox (auto-starting/creating it when
    // needed); fall back to any running sandbox.
    const state = get();
    const sandboxes = Object.values(state.sandboxes);
    if (sandboxes.length === 0) {
      throw new Error("Create a workspace first — its sandbox provides the environment for Pi sessions.");
    }

    // 1. The sandbox of the active workspace, if any.
    let sandbox = state.activeWorkspaceId
      ? sandboxes.find((sb) => sb.workspaceId === state.activeWorkspaceId)
      : undefined;

    // 2. Missing sandbox for the selected workspace -> create + start it.
    if (!sandbox && state.activeWorkspaceId) {
      await state.startWorkspaceFlow(state.activeWorkspaceId);
      sandbox = Object.values(get().sandboxes).find((sb) => sb.workspaceId === state.activeWorkspaceId);
    }

    // 3. Stopped sandbox -> start it.
    if (sandbox && sandbox.status !== "running") {
      await state.startSandbox(sandbox.id);
      sandbox = get().sandboxes[sandbox.id];
    }

    // 4. Fallback: any running sandbox.
    if (!sandbox || sandbox.status !== "running") {
      sandbox = Object.values(get().sandboxes).find((sb) => sb.status === "running");
    }

    if (!sandbox) {
      throw new Error("Could not start the workspace sandbox.");
    }
    return state.createWorkspaceSession(sandbox.id);
  },

  renameSession: async (sessionId, title) => {
    const { session } = await api.renameSession(sessionId, title);
    set({ sessions: { ...get().sessions, [sessionId]: session } });
  },

  createWorkspaceSession: async (workspaceId) => {
    const { session } = await api.createWorkspaceSession(workspaceId, {
      title: `Session ${Object.keys(get().sessions).length + 1}`,
    });
    const sessions = { ...get().sessions, [session.id]: session };
    set({ sessions, sessionOrder: appendOrder(get().sessionOrder, session.id), activeSessionId: session.id });
  },

  createWorkspace: async (name, hostRootPath) => {
    const { workspace, sandbox } = await api.createWorkspace({ name, ...(hostRootPath ? { hostRootPath } : {}) });
    set({
      workspaces: { ...get().workspaces, [workspace.id]: workspace },
      workspaceOrder: appendOrder(get().workspaceOrder, workspace.id),
      sandboxes: { ...get().sandboxes, [sandbox.id]: sandbox },
      sandboxOrder: appendOrder(get().sandboxOrder, sandbox.id),
      activeWorkspaceId: workspace.id,
      activeSandboxId: sandbox.id,
    });
  },

  createSandbox: async (name, hostPath) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) throw new Error("no active workspace");
    const { sandbox } = await api.createSandbox(workspaceId, {
      ...(name ? { name } : {}),
      ...(hostPath ? { hostPath } : {}),
      securityProfile: "standard",
    });
    set({
      sandboxes: { ...get().sandboxes, [sandbox.id]: sandbox },
      sandboxOrder: appendOrder(get().sandboxOrder, sandbox.id),
      activeSandboxId: sandbox.id,
    });
  },

  startSandbox: async (sandboxId) => {
    const { sandbox } = await api.startSandbox(sandboxId);
    set({ sandboxes: { ...get().sandboxes, [sandboxId]: sandbox } });
  },

  // Workspace-level convenience: the server ensures the sandbox exists
  // (auto-created with the workspace name) then starts/stops it.
  startWorkspaceFlow: async (workspaceId) => {
    const { sandbox } = await api.startWorkspace(workspaceId);
    set({ sandboxes: { ...get().sandboxes, [sandbox.id]: sandbox }, activeWorkspaceId: workspaceId, activeSandboxId: sandbox.id });
  },

  stopWorkspaceFlow: async (workspaceId) => {
    const { sandbox } = await api.stopWorkspace(workspaceId);
    set({ sandboxes: { ...get().sandboxes, [sandbox.id]: sandbox } });
  },

  stopSandbox: async (sandboxId) => {
    const { sandbox } = await api.stopSandbox(sandboxId);
    set({ sandboxes: { ...get().sandboxes, [sandboxId]: sandbox } });
  },

  removeSandbox: async (sandboxId) => {
    await api.removeSandbox(sandboxId);
    const sandboxes = { ...get().sandboxes };
    delete sandboxes[sandboxId];
    set({
      sandboxes,
      sandboxOrder: get().sandboxOrder.filter((id) => id !== sandboxId),
      activeSandboxId: get().activeSandboxId === sandboxId ? null : get().activeSandboxId,
    });
  },

  prepareSandbox: async () => {
    set({ sandboxBusy: true });
    try {
      const result = await api.sandboxPrepare();
      const status = await api.sandboxStatus();
      set({ sandbox: status.status, sandboxBusy: false });
      if (!result.ok) {
        console.warn("sandbox prepare incomplete", result.messages);
      }
    } catch (error) {
      set({ sandboxBusy: false });
      throw error;
    }
  },

  runSelfTest: async () => {
    set({ sandboxBusy: true });
    try {
      const result = await api.sandboxSelfTest();
      set({ selfTest: result.checks, sandboxBusy: false });
    } catch (error) {
      set({ sandboxBusy: false });
      throw error;
    }
  },

  setRequestedFile: (requestedFile) => set({ requestedFile }),

  clearLog: () => set({ log: [] }),

  loadSettings: async () => {
    try {
      const { settings } = await api.getSettings();
      set({ showThinkingByDefault: settings.defaults?.showThinkingByDefault ?? false });
    } catch {
      /* non-fatal */
    }
  },

  setShowThinkingByDefault: (value) => {
    set({ showThinkingByDefault: value });
    void api.saveDefaults({ showThinkingByDefault: value }).catch(() => undefined);
  },

  apply: (envelope) => {
    const state = get();
    const sessionId = envelope.sessionId;
    const items = state.items;

    // Verbose log: every envelope, bounded to the last 2000.
    set({
      log: [
        ...state.log.slice(-1999),
        { seq: envelope.seq, ts: envelope.timestamp, type: envelope.type, scope: envelope.scope, sessionId, payload: envelope.payload },
      ],
    });
    // During replay, buffered entity-created events can resurrect deleted
    // items; the authoritative REST load covers current state instead.
    if (state.replaying) {
      if (
        envelope.type === EVENT_TYPES.workspaceCreated ||
        envelope.type === EVENT_TYPES.sandboxCreated ||
        envelope.type === EVENT_TYPES.sessionCreated
      ) {
        return;
      }
    }

    const upsertSession = (info: SessionInfo) => {
      const sessions = { ...state.sessions, [info.id]: info };
      const sessionOrder = state.sessionOrder.includes(info.id)
        ? state.sessionOrder
        : [...state.sessionOrder, info.id];
      set({ sessions, sessionOrder });
    };

    const push = (item: ChatItem, sid = sessionId) => {
      if (!sid) return;
      set({ items: { ...items, [sid]: [...(items[sid] ?? []), item] } });
    };

    const updateItem = (
      sid: string,
      predicate: (item: ChatItem) => boolean,
      mutate: (item: ChatItem) => ChatItem,
    ) => {
      const list = items[sid] ?? [];
      const index = list.findIndex(predicate);
      if (index === -1) return;
      const next = [...list];
      next[index] = mutate(next[index] as ChatItem);
      set({ items: { ...items, [sid]: next } });
    };

    const updateSession = (sid: string, mutate: (s: SessionInfo) => SessionInfo) => {
      const current = state.sessions[sid];
      if (!current) return;
      set({ sessions: { ...state.sessions, [sid]: mutate(current) } });
    };

    switch (envelope.type) {
      case EVENT_TYPES.sessionCreated: {
        const info = (envelope.payload as { session: SessionInfo }).session;
        upsertSession(info);
        push({ kind: "system", text: "Session created", tone: "info" }, info.id);
        break;
      }
      case EVENT_TYPES.workspaceCreated: {
        const info = (envelope.payload as { workspace: WorkspaceInfo }).workspace;
        set({
          workspaces: { ...state.workspaces, [info.id]: info },
          workspaceOrder: state.workspaceOrder.includes(info.id) ? state.workspaceOrder : [...state.workspaceOrder, info.id],
        });
        break;
      }
      case EVENT_TYPES.sandboxCreated: {
        const info = (envelope.payload as { sandbox: SandboxInfo }).sandbox;
        set({
          sandboxes: { ...state.sandboxes, [info.id]: info },
          sandboxOrder: state.sandboxOrder.includes(info.id) ? state.sandboxOrder : [...state.sandboxOrder, info.id],
        });
        break;
      }
      case EVENT_TYPES.sandboxState: {
        const payload = envelope.payload as { sandboxId: string; status: SandboxInfo["status"] };
        const current = state.sandboxes[payload.sandboxId];
        if (current) {
          set({ sandboxes: { ...state.sandboxes, [payload.sandboxId]: { ...current, status: payload.status } } });
        }
        break;
      }
      case EVENT_TYPES.sandboxStatus: {
        set({ sandbox: envelope.payload as SandboxStatusInfo });
        break;
      }
      case EVENT_TYPES.agentState: {
        // Agent connection state reflects in the sandbox status detail.
        const payload = envelope.payload as { workspaceId: string; state: string };
        const current = state.sandboxes[payload.workspaceId];
        if (current && current.status === "running") {
          set({ sandboxes: { ...state.sandboxes, [payload.workspaceId]: { ...current } } });
        }
        break;
      }
      case EVENT_TYPES.sessionSnapshot: {
        const payload = envelope.payload as { sessionId: string; session: SessionInfo; reason: string };
        // Replay gap (server restart / very old lastSeq): the streamed
        // transcript is not reconstructable — show current authoritative
        // state and let the native pi session be the source of truth.
        upsertSession(payload.session);
        set({
          items: {
            ...items,
            [payload.sessionId]: [
              {
                kind: "system",
                text: `Reconnected (${payload.reason}) — showing current session state; full transcript lives in the native Pi session.`,
                tone: "info",
              },
            ],
          },
        });
        break;
      }
      case EVENT_TYPES.sessionLease: {
        const payload = envelope.payload as { sessionId: string; holder: string | null; expiresAt: number | null };
        set({ leases: { ...state.leases, [payload.sessionId]: { holder: payload.holder, expiresAt: payload.expiresAt } } });
        break;
      }
      case EVENT_TYPES.serverHello: {
        const payload = envelope.payload as { clientId: string };
        set({ clientId: payload.clientId });
        break;
      }
      case EVENT_TYPES.sessionUpdated: {
        const payload = envelope.payload as { sessionId: string; session: SessionInfo };
        upsertSession(payload.session);
        break;
      }
      case EVENT_TYPES.sessionState: {
        const payload = envelope.payload as { sessionId: string; status: SessionInfo["status"] };
        updateSession(payload.sessionId, (s) => ({ ...s, status: payload.status }));
        break;
      }
      case EVENT_TYPES.userMessage: {
        const payload = envelope.payload as {
          sessionId: string;
          messageId: string;
          content: string;
          createdAt: string;
        };
        push({
          kind: "user",
          messageId: payload.messageId,
          content: payload.content,
          createdAt: payload.createdAt,
          ts: envelope.timestamp,
        });
        break;
      }
      case EVENT_TYPES.assistantStart: {
        const payload = envelope.payload as { sessionId: string; messageId: string };
        push({ kind: "assistant", messageId: payload.messageId, text: "", streaming: true, ts: envelope.timestamp });
        break;
      }
      case EVENT_TYPES.assistantDelta: {
        const payload = envelope.payload as { sessionId: string; messageId: string; content: string };
        updateItem(
          payload.sessionId,
          (i) => i.kind === "assistant" && i.messageId === payload.messageId,
          (i) => (i.kind === "assistant" ? { ...i, text: i.text + payload.content } : i),
        );
        break;
      }
      case EVENT_TYPES.assistantEnd: {
        const payload = envelope.payload as { sessionId: string; messageId: string };
        updateItem(
          payload.sessionId,
          (i) => i.kind === "assistant" && i.messageId === payload.messageId,
          (i) => (i.kind === "assistant" ? { ...i, streaming: false } : i),
        );
        break;
      }
      case EVENT_TYPES.thinkingStart: {
        const payload = envelope.payload as { sessionId: string; messageId: string };
        push({ kind: "thinking", messageId: payload.messageId, text: "", done: false, open: true, ts: envelope.timestamp });
        break;
      }
      case EVENT_TYPES.thinkingDelta: {
        const payload = envelope.payload as { sessionId: string; messageId: string; content: string };
        updateItem(
          payload.sessionId,
          (i) => i.kind === "thinking" && i.messageId === payload.messageId,
          (i) => (i.kind === "thinking" ? { ...i, text: i.text + payload.content } : i),
        );
        break;
      }
      case EVENT_TYPES.thinkingEnd: {
        const payload = envelope.payload as { sessionId: string; messageId: string };
        updateItem(
          payload.sessionId,
          (i) => i.kind === "thinking" && i.messageId === payload.messageId,
          (i) => (i.kind === "thinking" ? { ...i, done: true, open: get().showThinkingByDefault } : i),
        );
        break;
      }
      case EVENT_TYPES.toolStart: {
        const payload = envelope.payload as {
          sessionId: string;
          toolCallId: string;
          name: string;
          input?: unknown;
        };
        push({ kind: "tool", toolCallId: payload.toolCallId, name: payload.name, input: payload.input, status: "running", ts: envelope.timestamp });
        break;
      }
      case EVENT_TYPES.toolUpdate: {
        const payload = envelope.payload as { sessionId: string; toolCallId: string; output?: string };
        if (payload.output === undefined) break;
        updateItem(
          payload.sessionId,
          (i) => i.kind === "tool" && i.toolCallId === payload.toolCallId,
          (i) => (i.kind === "tool" ? { ...i, output: payload.output } : i),
        );
        break;
      }
      case EVENT_TYPES.toolEnd: {
        const payload = envelope.payload as {
          sessionId: string;
          toolCallId: string;
          output: string;
          durationMs: number;
        };
        updateItem(
          payload.sessionId,
          (i) => i.kind === "tool" && i.toolCallId === payload.toolCallId,
          (i) =>
            i.kind === "tool"
              ? { ...i, status: "done", output: payload.output, durationMs: payload.durationMs }
              : i,
        );
        break;
      }
      case EVENT_TYPES.toolError: {
        const payload = envelope.payload as { sessionId: string; toolCallId: string; error: string };
        updateItem(
          payload.sessionId,
          (i) => i.kind === "tool" && i.toolCallId === payload.toolCallId,
          (i) => (i.kind === "tool" ? { ...i, status: "error", error: payload.error } : i),
        );
        break;
      }
      case EVENT_TYPES.modelUpdated: {
        const payload = envelope.payload as { sessionId: string; model: string };
        updateSession(payload.sessionId, (s) => ({ ...s, model: payload.model }));
        break;
      }
      case EVENT_TYPES.usageUpdated: {
        const payload = envelope.payload as { sessionId: string; usage: UsageInfo };
        set({ usage: { ...state.usage, [payload.sessionId]: payload.usage } });
        break;
      }
      case EVENT_TYPES.sessionError: {
        const payload = envelope.payload as { sessionId?: string; message: string };
        push({ kind: "system", text: `Error: ${payload.message}`, tone: "error" });
        break;
      }
      case EVENT_TYPES.sessionClosed: {
        const payload = envelope.payload as { sessionId: string; reason: string };
        push({ kind: "system", text: `Session closed: ${payload.reason}`, tone: "info" });
        break;
      }
      case EVENT_TYPES.replayComplete: {
        const payload = envelope.payload as { lastSeq: number };
        set({ lastSeq: Math.max(state.lastSeq, payload.lastSeq), replaying: false });
        break;
      }
    }

    if (envelope.seq > state.lastSeq) {
      set({ lastSeq: envelope.seq });
    }
  },
}));
