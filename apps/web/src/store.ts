import { create } from "zustand";
import type { EventEnvelope, SessionInfo, UsageInfo } from "@pi-control/protocol";
import { EVENT_TYPES } from "@pi-control/protocol";
import { api } from "./api";

export type ChatItem =
  | { kind: "user"; messageId: string; content: string; createdAt: string }
  | { kind: "assistant"; messageId: string; text: string; streaming: boolean }
  | { kind: "thinking"; messageId: string; text: string; done: boolean; open: boolean }
  | {
      kind: "tool";
      toolCallId: string;
      name: string;
      input?: unknown;
      output?: string;
      durationMs?: number;
      status: "running" | "done" | "error";
      error?: string;
    }
  | { kind: "system"; text: string; tone: "info" | "error" };

interface PiControlState {
  connection: "connecting" | "open" | "closed";
  sessions: Record<string, SessionInfo>;
  sessionOrder: string[];
  items: Record<string, ChatItem[]>;
  usage: Record<string, UsageInfo>;
  activeSessionId: string | null;
  lastSeq: number;

  setConnection(connection: PiControlState["connection"]): void;
  setActive(sessionId: string | null): void;
  createSession(): Promise<void>;
  apply(envelope: EventEnvelope): void;
}

export const usePiControl = create<PiControlState>((set, get) => ({
  connection: "closed",
  sessions: {},
  sessionOrder: [],
  items: {},
  usage: {},
  activeSessionId: null,
  lastSeq: 0,

  setConnection: (connection) => set({ connection }),
  setActive: (activeSessionId) => set({ activeSessionId }),

  createSession: async () => {
    const { session } = await api.createSession({
      title: `Session ${Object.keys(get().sessions).length + 1}`,
    });
    const sessions = { ...get().sessions, [session.id]: session };
    const sessionOrder = get().sessionOrder.includes(session.id)
      ? get().sessionOrder
      : [...get().sessionOrder, session.id];
    set({ sessions, sessionOrder, activeSessionId: session.id });
  },

  apply: (envelope) => {
    const state = get();
    const sessionId = envelope.sessionId;
    const items = state.items;

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
        });
        break;
      }
      case EVENT_TYPES.assistantStart: {
        const payload = envelope.payload as { sessionId: string; messageId: string };
        push({ kind: "assistant", messageId: payload.messageId, text: "", streaming: true });
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
        push({ kind: "thinking", messageId: payload.messageId, text: "", done: false, open: true });
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
          (i) => (i.kind === "thinking" ? { ...i, done: true, open: false } : i),
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
        push({ kind: "tool", toolCallId: payload.toolCallId, name: payload.name, input: payload.input, status: "running" });
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
        set({ lastSeq: Math.max(state.lastSeq, payload.lastSeq) });
        break;
      }
    }

    if (envelope.seq > state.lastSeq) {
      set({ lastSeq: envelope.seq });
    }
  },
}));
