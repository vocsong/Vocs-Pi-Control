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

  const session = activeSessionId ? sessions[activeSessionId] : undefined;
  const messages = activeSessionId ? (items[activeSessionId] ?? []) : [];
  const sessionUsage = activeSessionId ? usage[activeSessionId] : undefined;

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
    if (sessionInfo?.workspaceId) {
      api
        .listModels(sessionInfo.workspaceId)
        .then(({ models: m }) => setModels(m))
        .catch(() => undefined);
    }
  }, [activeSessionId, loadCapabilities]);

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
        <span className="session-header-title">{session.title}</span>
        <span className={`status-dot status-${session.status}`} title={session.status} />
        <span className="session-header-meta">{session.status}</span>
        {session.workspaceId && (
          <>
            {models.length > 0 && (
              <select
                className="session-control"
                title="Model (provider/model-id)"
                value={session.model ?? ""}
                onChange={(e) => void setModel(e.target.value)}
              >
                <option value={session.model ?? ""}>{session.model ?? "default"}</option>
                {models
                  .filter((m) => m.id !== session.model)
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
        {messages.length === 0 ? (
          <div className="empty-chat">Ask Pi something to get started.</div>
        ) : (
          messages.map((item, index) => <Message key={index} item={item} />)
        )}
      </div>
    </main>
  );
}
