import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatItem } from "../store";
import { usePiControl } from "../store";
import { api } from "../api";

function UserMessage({ item }: { item: Extract<ChatItem, { kind: "user" }> }) {
  return (
    <div className="msg msg-user">
      <div className="msg-role">You</div>
      <div className="msg-content">{item.content}</div>
    </div>
  );
}

function AssistantMessage({ item }: { item: Extract<ChatItem, { kind: "assistant" }> }) {
  return (
    <div className="msg msg-assistant">
      <div className="msg-role">Pi {item.streaming && <span className="cursor-blink">▋</span>}</div>
      <div className="msg-content">{item.text || <span className="msg-placeholder">…</span>}</div>
    </div>
  );
}

function ThinkingMessage({ item }: { item: Extract<ChatItem, { kind: "thinking" }> }) {
  return (
    <details className="msg msg-thinking" open={item.open}>
      <summary className="msg-role">Thinking</summary>
      <div className="msg-content thinking-text">{item.text || "…"}</div>
    </details>
  );
}

function ToolMessage({ item }: { item: Extract<ChatItem, { kind: "tool" }> }) {
  return (
    <details className="msg msg-tool" open={item.status === "running"}>
      <summary className="msg-role">
        <span className={`tool-status tool-${item.status}`}>
          {item.status === "running" ? "⚙" : item.status === "done" ? "✓" : "✕"}
        </span>
        {item.name}
        {item.durationMs !== undefined && <span className="tool-duration"> {item.durationMs}ms</span>}
      </summary>
      <div className="tool-input">
        <pre>{JSON.stringify(item.input ?? {}, null, 2)}</pre>
      </div>
      {item.output !== undefined && (
        <pre className="tool-output">{item.output.length > 4000 ? item.output.slice(-4000) + "\n…" : item.output}</pre>
      )}
      {item.error !== undefined && <pre className="tool-output tool-error">{item.error}</pre>}
    </details>
  );
}

function SystemMessage({ item }: { item: Extract<ChatItem, { kind: "system" }> }) {
  return <div className={`msg msg-system msg-system-${item.tone}`}>{item.text}</div>;
}

function Message({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "assistant":
      return <AssistantMessage item={item} />;
    case "thinking":
      return <ThinkingMessage item={item} />;
    case "tool":
      return <ToolMessage item={item} />;
    case "system":
      return <SystemMessage item={item} />;
  }
}

export function ChatView() {
  const activeSessionId = usePiControl((s) => s.activeSessionId);
  const sessions = usePiControl((s) => s.sessions);
  const items = usePiControl((s) => s.items);
  const usage = usePiControl((s) => s.usage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [capabilities, setCapabilities] = useState<Record<string, unknown> | null>(null);
  const [showCaps, setShowCaps] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const session = activeSessionId ? sessions[activeSessionId] : undefined;
  const messages = activeSessionId ? (items[activeSessionId] ?? []) : [];
  const sessionUsage = activeSessionId ? usage[activeSessionId] : undefined;

  // Transcript search (Ctrl+F): filter rendered messages.
  const searchTerms = searchQuery.trim().toLowerCase();
  const visibleMessages = searchTerms
    ? messages.filter((m) => {
        const text =
          m.kind === "user"
            ? m.content
            : m.kind === "assistant"
              ? m.text
              : m.kind === "thinking"
                ? m.text
                : m.kind === "tool"
                  ? JSON.stringify(m.input ?? "") + (m.output ?? "")
                  : "";
        return text.toLowerCase().includes(searchTerms);
      })
    : messages;

  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadTranscript = useCallback(async (sessionId: string) => {
    try {
      const { messages } = await api.sessionTranscript(sessionId);
      if (messages.length === 0) return;
      const items: ChatItem[] = [
        { kind: "system", text: "Restored from the native Pi session", tone: "info" },
        ...messages.map((m) => {
          if (m.role === "user") {
            return { kind: "user" as const, messageId: crypto.randomUUID(), content: m.text ?? "", createdAt: new Date().toISOString(), ts: Date.now() };
          }
          if (m.role === "tool") {
            return { kind: "tool" as const, toolCallId: crypto.randomUUID(), name: m.toolName ?? "tool", output: m.output, status: "done" as const, ts: Date.now() };
          }
          return { kind: "assistant" as const, messageId: crypto.randomUUID(), text: m.text ?? "", streaming: false, ts: Date.now() };
        }),
      ];
      const itemsWithThinking = items.flatMap((item) =>
        item.kind === "assistant" ? [] : [item],
      );
      void itemsWithThinking;
      usePiControl.setState((st) => ({
        items: { ...st.items, [sessionId]: [...(st.items[sessionId] ?? []), ...items] },
      }));
    } catch {
      // agent offline / session not live — the UI shows the existing hint
    }
  }, []);

  const loadCapabilities = useCallback(async () => {
    if (!activeSessionId) return;
    const s = usePiControl.getState().sessions[activeSessionId];
    if (!s?.workspaceId) return;
    try {
      const { capabilities: caps } = await api.sessionCapabilities(activeSessionId);
      setCapabilities(caps);
    } catch {
      /* agent offline etc. */
    }
  }, [activeSessionId]);

  useEffect(() => {
    setCapabilities(null);
    setModels([]);
    if (activeSessionId) void loadCapabilities();
    const sessionInfo = activeSessionId ? usePiControl.getState().sessions[activeSessionId] : undefined;
    // Restore history from the native Pi session when the live replay
    // cannot (server restart / buffer eviction / stopped sandbox).
    const existing = activeSessionId ? (usePiControl.getState().items[activeSessionId] ?? []) : [];
    if (activeSessionId && sessionInfo?.workspaceId && existing.length === 0) {
      void loadTranscript(activeSessionId);
    }
    if (sessionInfo?.workspaceId) {
      api
        .listModels(sessionInfo.workspaceId)
        .then(({ models: m }) => setModels(m))
        .catch(() => undefined);
    }
  }, [activeSessionId, loadCapabilities, loadTranscript]);

  // The stored model may be id-only (old rows) or qualified — normalize to
  // provider/id for comparison with the catalog so no duplicates appear.
  const currentQualified = (() => {
    if (!session?.model) return "";
    if (session.model.includes("/")) return session.model;
    const found = models.find((m) => m.id === session.model);
    return found ? `${found.provider}/${found.id}` : session.model;
  })();

  const saveTitle = async () => {
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    if (!trimmed || !activeSessionId || trimmed === usePiControl.getState().sessions[activeSessionId]?.title) return;
    try {
      await usePiControl.getState().renameSession(activeSessionId, trimmed);
    } catch (e) {
      setControlError(e instanceof Error ? e.message : String(e));
    }
  };

  const setModel = async (model: string) => {
    if (!activeSessionId) return;
    setControlError(null);
    try {
      await api.setSessionModel(activeSessionId, model);
    } catch (e) {
      setControlError(e instanceof Error ? e.message : String(e));
    }
  };

  const setThinking = async (level: string) => {
    if (!activeSessionId) return;
    setControlError(null);
    try {
      await api.setSessionThinking(activeSessionId, level);
    } catch (e) {
      setControlError(e instanceof Error ? e.message : String(e));
    }
  };

  const compact = async () => {
    if (!activeSessionId) return;
    setControlError(null);
    try {
      await api.compactSession(activeSessionId);
      void loadCapabilities();
    } catch (e) {
      setControlError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (!session) {
    return (
      <main className="main">
        <div className="empty-state">
          <h1>Vocs Pi Control</h1>
          <p>Select a session, or create a new one from the sidebar.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <header className="session-header">
        {editingTitle ? (
          <input
            autoFocus
            className="session-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle();
              if (e.key === "Escape") setEditingTitle(false);
            }}
          />
        ) : (
          <span
            className="session-header-title editable-title"
            title="Click to rename"
            onClick={() => {
              setTitleDraft(session.title);
              setEditingTitle(true);
            }}
          >
            {session.title}
          </span>
        )}
        <span className={`status-dot status-${session.status}`} title={session.status} />
        <span className="session-header-meta">{session.status}</span>
        {session.workspaceId && (
          <>
            {models.length > 0 && (
              <select
                className="session-control"
                title="Model (provider/model-id)"
                value={currentQualified}
                onChange={(e) => void setModel(e.target.value)}
              >
                <option value={currentQualified}>{currentQualified || "default"}</option>
                {models
                  .filter((m) => `${m.provider}/${m.id}` !== currentQualified)
                  .map((m) => (
                    <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                      {m.provider}/{m.id}
                    </option>
                  ))}
              </select>
            )}
            <select
              className="session-control"
              title="Thinking level"
              value={session.thinkingLevel ?? ""}
              onChange={(e) => void setThinking(e.target.value)}
            >
              <option value={session.thinkingLevel ?? ""}>{session.thinkingLevel ?? "default"}</option>
              {["off", "minimal", "low", "medium", "high", "xhigh", "max"]
                .filter((l) => l !== session.thinkingLevel)
                .map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
            </select>
            <button className="btn btn-small" title="Compact context" onClick={() => void compact()}>
              Compact
            </button>
            <button className="btn btn-small" title="Tools / skills / extensions" onClick={() => setShowCaps((v) => !v)}>
              Caps
            </button>
          </>
        )}
        {sessionUsage && (
          <span className="session-header-meta" title="Context usage">
            ctx {sessionUsage.contextPercent ?? "?"}%
          </span>
        )}
        {controlError && <span className="form-error">{controlError}</span>}
        <input
          ref={searchInputRef}
          className="transcript-search"
          placeholder="Search transcript (Ctrl+F)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchTerms && (
          <span className="session-header-meta">
            {visibleMessages.length}/{messages.length} shown
          </span>
        )}
      </header>
      {showCaps && capabilities && (
        <div className="caps-popover">
          {(Object.keys(capabilities) as Array<keyof typeof capabilities>)
            .filter((k) => Array.isArray(capabilities[k]) && (capabilities[k] as unknown[]).length > 0)
            .map((k) => (
              <div key={String(k)} className="caps-row">
                <span className="caps-key">{String(k)}</span>
                <span className="caps-values">{(capabilities[k] as string[]).join(", ")}</span>
              </div>
            ))}
        </div>
      )}
      <div className="messages" ref={scrollRef}>
        {visibleMessages.length === 0 ? (
          <div className="empty-chat">
            {searchTerms ? "No messages match the search." : "Ask Pi something to get started."}
          </div>
        ) : (
          visibleMessages.map((item, index) => <Message key={index} item={item} />)
        )}
      </div>
    </main>
  );
}
