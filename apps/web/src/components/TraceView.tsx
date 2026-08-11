import { usePiControl, type ChatItem } from "../store";

/** Timeline derived from the live session event stream (plan §38). */
export function TraceView() {
  const activeSessionId = usePiControl((s) => s.activeSessionId);
  const items = usePiControl((s) => s.items);
  const sessions = usePiControl((s) => s.sessions);

  const session = activeSessionId ? sessions[activeSessionId] : undefined;
  const list = activeSessionId ? (items[activeSessionId] ?? []) : [];

  if (!session) {
    return <div className="files-empty">Select a session to see its trace.</div>;
  }

  const rows = list.filter((item) => item.kind !== "system");

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

  return (
    <div className="trace-view">
      <div className="trace-header">
        <span className="trace-title">Trace — {session.title}</span>
        <span className="trace-meta">{list.length} events</span>
      </div>
      <div className="trace-list">
        {rows.length === 0 ? (
          <div className="files-empty">No events yet. Send a prompt to see the trace.</div>
        ) : (
          [...rows].reverse().map(render)
        )}
      </div>
    </div>
  );
}
