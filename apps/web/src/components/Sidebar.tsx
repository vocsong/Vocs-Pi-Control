import { useState } from "react";
import type { WorkspaceInfo } from "@pi-control/protocol";
import { usePiControl } from "../store";
import { api } from "../api";

/* ------------------------------------------------------------------ */
/* Status helpers                                                      */
/* ------------------------------------------------------------------ */

const STATUS_DOT: Record<string, string> = {
  running: "●",
  idle: "○",
  starting: "◌",
  waiting: "◌",
  aborting: "◌",
  stopped: "○",
  error: "✕",
};

const SANDBOX_STATUS: Record<string, { dot: string; cls: string }> = {
  running: { dot: "●", cls: "status-running" },
  starting: { dot: "◌", cls: "status-waiting" },
  stopping: { dot: "◌", cls: "status-waiting" },
  building: { dot: "◌", cls: "status-waiting" },
  stopped: { dot: "○", cls: "" },
  missing: { dot: "○", cls: "" },
  error: { dot: "✕", cls: "status-error" },
};

/* ------------------------------------------------------------------ */
/* Add workspace form                                                  */
/* ------------------------------------------------------------------ */

function AddWorkspaceForm({ onDone }: { onDone: () => void }) {
  const createWorkspace = usePiControl((s) => s.createWorkspace);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createWorkspace(name.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-form">
      <input
        autoFocus
        placeholder="Workspace name (e.g. my-app)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button className="btn btn-small" onClick={() => void submit()} disabled={busy || !name.trim()}>
          Add workspace
        </button>
        <button className="btn btn-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace row (flattened: start/stop right on the row)              */
/* ------------------------------------------------------------------ */

function WorkspaceRow({ workspace }: { workspace: WorkspaceInfo }) {
  const sandboxes = usePiControl((s) => s.sandboxes);
  const activeWorkspaceId = usePiControl((s) => s.activeWorkspaceId);
  const selectWorkspace = usePiControl((s) => s.selectWorkspace);
  const startWorkspaceFlow = usePiControl((s) => s.startWorkspaceFlow);
  const stopWorkspaceFlow = usePiControl((s) => s.stopWorkspaceFlow);
  const [busy, setBusy] = useState(false);

  const sandbox = Object.values(sandboxes).find((sb) => sb.workspaceId === workspace.id);
  const sandboxStatus = sandbox?.status ?? "missing";
  const status = SANDBOX_STATUS[sandboxStatus] ?? SANDBOX_STATUS.missing!;
  const running = sandboxStatus === "running";
  // starting/building/stopping: transient — everything disabled.
  const transitioning = ["starting", "building", "stopping"].includes(sandboxStatus);
  const disabled = busy || transitioning;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    if (!sandbox) return;
    setBusy(true);
    try {
      // Rebuild = stop -> recreate container -> start again.
      const { sandbox: rebuilt } = await api.rebuildSandbox(sandbox.id);
      usePiControl.setState((s) => ({ sandboxes: { ...s.sandboxes, [sandbox.id]: rebuilt } }));
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`workspace-row-item ${workspace.id === activeWorkspaceId ? "active" : ""}`}>
      <div className="project-row">
        <button className="project-main" onClick={() => selectWorkspace(workspace.id)}>
          <span className={`status-dot ${status.cls}`}>{status.dot}</span>
          <span className="project-name">{workspace.name}</span>
        </button>
        <span className="project-actions">
          {running ? (
            <button className="btn btn-icon" title="Stop" disabled={disabled} onClick={() => void act(() => stopWorkspaceFlow(workspace.id))}>
              ■
            </button>
          ) : (
            <button
              className="btn btn-icon"
              title="Start"
              disabled={disabled}
              onClick={() => void act(() => startWorkspaceFlow(workspace.id))}
            >
              ▶
            </button>
          )}
          <button className="btn btn-icon" title="Rebuild (stops and starts again)" disabled={disabled || !sandbox} onClick={() => void rebuild()}>
            ⟳
          </button>
        </span>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Runtime panel                                                       */
/* ------------------------------------------------------------------ */

function SandboxPanel() {
  const sandbox = usePiControl((s) => s.sandbox);
  const sandboxBusy = usePiControl((s) => s.sandboxBusy);
  const selfTest = usePiControl((s) => s.selfTest);
  const prepareSandbox = usePiControl((s) => s.prepareSandbox);
  const runSelfTest = usePiControl((s) => s.runSelfTest);
  const [expanded, setExpanded] = useState(false);

  if (!sandbox) return null;

  const ready = sandbox.detected && sandbox.rootlessAvailable;

  return (
    <div className="sandbox-panel">
      <button className="sandbox-header" onClick={() => setExpanded((v) => !v)}>
        <span className={`sandbox-dot ${ready ? "ok" : sandbox.detected ? "warn" : "bad"}`}>●</span>
        <span>Runtime: {sandbox.runtime}</span>
        <span className="project-caret">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="sandbox-body">
          <div className="sandbox-line">{sandbox.detected ? `Podman ${sandbox.version ?? ""}`.trim() : "Podman not detected"}</div>
          {sandbox.machineRequired && (
            <div className="sandbox-line">
              Machine: {sandbox.machineConfigured ? (sandbox.machineRunning ? "running" : "stopped") : "not configured"}
            </div>
          )}
          <div className="sandbox-line">Rootless: {sandbox.rootlessAvailable ? "yes" : "no"}</div>
          <div className="sandbox-actions">
            <button className="btn btn-small" onClick={() => void prepareSandbox()} disabled={sandboxBusy}>
              {sandboxBusy ? "Working…" : "Prepare"}
            </button>
            <button className="btn btn-small" onClick={() => void runSelfTest()} disabled={sandboxBusy}>
              Self-test
            </button>
          </div>
          {selfTest && (
            <ul className="selftest-list">
              {selfTest.map((check) => (
                <li key={check.name} className={check.ok ? "ok" : "bad"}>
                  {check.ok ? "✓" : "✕"} {check.name}
                  {!check.ok && <span className="selftest-detail"> — {check.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

export function Sidebar() {
  const sessions = usePiControl((s) => s.sessions);
  const sessionOrder = usePiControl((s) => s.sessionOrder);
  const activeSessionId = usePiControl((s) => s.activeSessionId);
  const setActive = usePiControl((s) => s.setActive);
  const createSession = usePiControl((s) => s.createSession);
  const workspaces = usePiControl((s) => s.workspaces);
  const workspaceOrder = usePiControl((s) => s.workspaceOrder);
  const sandboxes = usePiControl((s) => s.sandboxes);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const workspaceNameFor = (sessionId: string): string | null => {
    const session = usePiControl.getState().sessions[sessionId];
    if (!session?.workspaceId) return null;
    const sandbox = usePiControl.getState().sandboxes[session.workspaceId];
    const workspace = sandbox ? usePiControl.getState().workspaces[sandbox.workspaceId] : undefined;
    return workspace?.name ?? null;
  };

  const deleteSession = async (sessionId: string) => {
    if (!window.confirm("Delete this session?")) return;
    try {
      await api.deleteSession(sessionId);
      usePiControl.setState((st) => {
        const sessions = { ...st.sessions };
        const items = { ...st.items };
        delete sessions[sessionId];
        delete items[sessionId];
        return {
          sessions,
          items,
          sessionOrder: st.sessionOrder.filter((id) => id !== sessionId),
          activeSessionId: st.activeSessionId === sessionId ? null : st.activeSessionId,
        };
      });
    } catch (e) {
      console.error(e);
    }
  };

  const newSession = async () => {
    setSessionError(null);
    try {
      await createSession();
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Workspaces</span>
          <button className="btn btn-small" onClick={() => setAddingWorkspace((v) => !v)}>
            + Add
          </button>
        </div>
        {workspaceOrder.length === 0 && !addingWorkspace ? (
          <p className="sidebar-empty">No workspaces yet. Add one — it gets its sandbox automatically.</p>
        ) : (
          <ul className="project-list">
            {workspaceOrder.map((id) => {
              const workspace = workspaces[id];
              return workspace ? <WorkspaceRow key={id} workspace={workspace} /> : null;
            })}
            {addingWorkspace && <AddWorkspaceForm onDone={() => setAddingWorkspace(false)} />}
          </ul>
        )}
        {Object.keys(sandboxes).length === 0 && workspaceOrder.length > 0 && (
          <p className="sidebar-empty">Press ▶ to create and start the sandbox.</p>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Sessions</span>
          <button
            className="btn btn-small"
            disabled={workspaceOrder.length === 0}
            title={workspaceOrder.length === 0 ? "Create a workspace first" : "New Pi session (auto-starts the sandbox)"}
            onClick={() => void newSession()}
          >
            + New
          </button>
        </div>
        {sessionError && <div className="form-error">{sessionError}</div>}
        {sessionOrder.length === 0 ? (
          <p className="sidebar-empty">
            {workspaceOrder.length === 0 ? "Add a workspace to get started." : "Create a session to start chatting with Pi."}
          </p>
        ) : (
          <ul className="session-list">
            {sessionOrder.map((id) => {
              const session = sessions[id];
              if (!session) return null;
              const wsName = workspaceNameFor(id);
              return (
                <li key={id} className="session-li">
                  <button
                    className={`session-item ${id === activeSessionId ? "active" : ""}`}
                    onClick={() => setActive(id)}
                  >
                    <span className={`status-dot status-${session.status}`} title={session.status}>
                      {STATUS_DOT[session.status] ?? "○"}
                    </span>
                    <span className="session-title">{session.title}</span>
                    {wsName && <span className="session-badge">{wsName}</span>}
                  </button>
                  <button className="session-delete" title="Delete session" onClick={() => void deleteSession(id)}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <SandboxPanel />
    </aside>
  );
}
