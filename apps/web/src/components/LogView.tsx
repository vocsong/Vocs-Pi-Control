import { useEffect, useMemo, useRef, useState } from "react";
import { usePiControl } from "../store";

/**
 * LOG tab — the full verbose envelope stream for troubleshooting.
 * Shows every realtime event (seq, time, type, scope, payload) with
 * optional filtering to the active session.
 */
export function LogView() {
  const log = usePiControl((s) => s.log);
  const activeSessionId = usePiControl((s) => s.activeSessionId);
  const clearLog = usePiControl((s) => s.clearLog);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, sessionOnly, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return log.filter((entry) => {
      if (sessionOnly && entry.sessionId !== activeSessionId) return false;
      if (q && !entry.type.toLowerCase().includes(q) && !entry.scope.includes(q)) return false;
      return true;
    });
  }, [log, sessionOnly, activeSessionId, query]);

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of filtered) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  return (
    <div className="log-view">
      <div className="log-toolbar">
        <button className={`btn btn-small ${sessionOnly ? "active" : ""}`} onClick={() => setSessionOnly((v) => !v)}>
          {sessionOnly ? "session only" : "all events"}
        </button>
        <input
          className="log-filter"
          placeholder="Filter by event type (e.g. tool, thinking)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="log-count">{filtered.length} events</span>
        <button className="btn btn-small" onClick={clearLog}>
          Clear
        </button>
      </div>
      <div className="log-types">
        {types.slice(0, 12).map(([type, count]) => (
          <span key={type} className="log-type-chip" onClick={() => setQuery(type)} title={`Click to filter: ${type}`}>
            {type} ×{count}
          </span>
        ))}
      </div>
      <div className="log-stream" ref={scrollRef}>
        {filtered.length === 0 ? (
          <div className="files-empty">No events yet — send a prompt or interact with the UI.</div>
        ) : (
          filtered.map((entry, index) => (
            <div key={`${entry.seq}-${index}`} className={`log-entry log-${entry.scope}`}>
              <span className="log-seq">#{entry.seq}</span>
              <span className="log-time">{new Date(entry.ts).toLocaleTimeString()}</span>
              <span className="log-type-name">{entry.type}</span>
              <span className="log-scope">[{entry.scope}{entry.sessionId ? `:${entry.sessionId.slice(0, 8)}` : ""}]</span>
              <pre className="log-payload">{JSON.stringify(entry.payload)}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
