import { usePiControl } from "../store";

const STATUS_DOT: Record<string, string> = {
  running: "●",
  idle: "○",
  starting: "◌",
  waiting: "◌",
  aborting: "◌",
  stopped: "○",
  error: "✕",
};

export function Sidebar() {
  const sessions = usePiControl((s) => s.sessions);
  const sessionOrder = usePiControl((s) => s.sessionOrder);
  const activeSessionId = usePiControl((s) => s.activeSessionId);
  const setActive = usePiControl((s) => s.setActive);
  const createSession = usePiControl((s) => s.createSession);

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Sessions</span>
          <button className="btn btn-small" onClick={() => void createSession()}>
            + New
          </button>
        </div>
        {sessionOrder.length === 0 ? (
          <p className="sidebar-empty">No sessions yet. Create one to start.</p>
        ) : (
          <ul className="session-list">
            {sessionOrder.map((id) => {
              const session = sessions[id];
              if (!session) return null;
              return (
                <li key={id}>
                  <button
                    className={`session-item ${id === activeSessionId ? "active" : ""}`}
                    onClick={() => setActive(id)}
                  >
                    <span className={`status-dot status-${session.status}`} title={session.status}>
                      {STATUS_DOT[session.status] ?? "○"}
                    </span>
                    <span className="session-title">{session.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
