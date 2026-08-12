import { useEffect, useState } from "react";
import { usePiControl, type ChatItem } from "../store";
import { api } from "../api";

interface PersistedTrace {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  metadata?: unknown;
}

/** Timeline derived from the live session event stream (plan §38). */
export function TraceView() {
  const activeSessionId = usePiControl((s) => s.activeSessionId);
  const items = usePiControl((s) => s.items);
  const sessions = usePiControl((s) => s.sessions);
  const [persisted, setPersisted] = useState<PersistedTrace[] | null>(null);

  const session = activeSessionId ? sessions[activeSessionId] : undefined;
  const list = activeSessionId ? (items[activeSessionId] ?? []) : [];

  // Load the persisted control-plane trace so a reload/restart still shows
  // past activity even though the live store starts empty (#13).
  useEffect(() => {
    setPersisted(null);
    if (!activeSessionId) return;
    let cancelled = false;
    api
      .sessionTraces(activeSessionId)
      .then(({ traces }) => {
        if (!cancelled) setPersisted(traces);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  if (!session) {
    return <div className="files-empty">Select a session to see its trace.</div>;
  }

  const liveRows = list.filter((item) => item.kind !== "system");
  const showPersisted = persisted !== null && persisted.length > 0 && liveRows.length === 0;
  const count = showPersisted ? persisted.length : list.length;

  const render = (item: ChatItem) => {
    const time = "ts" in item && item.ts ? new Date(item.ts).toLocaleTimeString() : "";
    switch (item.kind) {
      case "user":
        return (
          <div key={`u-${item.messageId}`} className="trace-row trace-user">
            <span className="trace-time">{time}</span>
            <span className="trace-type">user.prompt</span>
            <span className="trace-detail">{item.content.slice(0, 80)}</span>
          </div>
        );
      case "assistant":
        return (
          <div key={`a-${item.messageId}`} className="trace-row trace-assistant">
            <span className="trace-time">{time}</span>
            <span className="trace-type">assistant</span>
            <span className="trace-detail">
              {item.streaming ? "streaming…" : `${item.text.length} chars`}
            </span>
          </div>
        );
      case "thinking":
        return (
          <div key={`t-${item.messageId}`} className="trace-row trace-thinking">
            <span className="trace-time">{time}</span>
            <span className="trace-type">thinking</span>
            <span className="trace-detail">{item.done ? `${item.text.length} chars` : "streaming…"}</span>
          </div>
        );
      case "tool":
        return (
          <div key={`tool-${item.toolCallId}`} className={`trace-row trace-tool ${item.status}`}>
            <span className="trace-time">{time}</span>
            <span className="trace-type">tool.{item.name}</span>
            <span className="trace-detail">
              {item.status === "running" ? "running…" : `${item.durationMs ?? "?"}ms`}
              {item.error ? ` · ${item.error.slice(0, 60)}` : ""}
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  const renderPersisted = (t: PersistedTrace) => {
    const time = new Date(t.startedAt).toLocaleTimeString();
    const detail = (() => {
      if (t.type === "user.prompt") {
        const text = (t.metadata as { text?: string } | undefined)?.text;
        return text ? text.slice(0, 80) : t.status;
      }
      if (t.type === "assistant.run") return t.status;
      if (t.type.startsWith("tool.")) {
        const durationMs = (t.metadata as { durationMs?: number } | undefined)?.durationMs;
        return t.status === "done" ? `${durationMs ?? "?"}ms` : t.status;
      }
      return t.status;
    })();
    const cls =
      t.type === "user.prompt" ? "trace-user" : t.type === "assistant.run" ? "trace-assistant" : "trace-tool";
    return (
      <div key={t.id} className={`trace-row ${cls} ${t.status === "error" ? "error" : ""}`}>
        <span className="trace-time">{time}</span>
        <span className="trace-type">{t.type}</span>
        <span className="trace-detail">{detail}</span>
      </div>
    );
  };

  return (
    <div className="trace-view">
      <div className="trace-header">
        <span className="trace-title">Trace — {session.title}</span>
        <span className="trace-meta">{count} events{showPersisted ? " · persisted" : ""}</span>
      </div>
      <div className="trace-list">
        {showPersisted ? (
          [...persisted].reverse().map(renderPersisted)
        ) : liveRows.length === 0 ? (
          <div className="files-empty">No events yet. Send a prompt to see the trace.</div>
        ) : (
          [...liveRows].reverse().map(render)
        )}
      </div>
    </div>
  );
}
