import { useState } from "react";
import type { SandboxInfo, WorkspaceInfo } from "@pi-control/protocol";
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
/* Inline forms                                                        */
/* ------------------------------------------------------------------ */

function AddWorkspaceForm({ onDone }: { onDone: () => void }) {
  const createWorkspace = usePiControl((s) => s.createWorkspace);
  const [name, setName] = useState("");
  const [subfolder, setSubfolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createWorkspace(name.trim(), subfolder.trim() || undefined);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-form">
      <input placeholder="Workspace name (e.g. my-app)" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        placeholder="Subfolder under root (optional, default: root/name)"
        value={subfolder}
        onChange={(e) => setSubfolder(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button className="btn btn-small" onClick={() => void submit()} disabled={busy}>
          Add workspace
        </button>
        <button className="btn btn-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddSandboxForm({ workspace, onDone }: { workspace: WorkspaceInfo; onDone: () => void }) {
  const createSandbox = usePiControl((s) => s.createSandbox);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // Same name as the workspace; default environment (node + python).
      await createSandbox(workspace.name);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-form">
      <p className="sidebar-empty">Sandbox “{workspace.name}” will be created with the default environment (Node + Python).</p>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button className="btn btn-small" onClick={() => void submit()} disabled={busy}>
          Create sandbox
        </button>
        <button className="btn btn-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sandbox node (container)                                            */
/* ------------------------------------------------------------------ */

function SandboxNode({ sandbox }: { sandbox: SandboxInfo }) {
  const activeSandboxId = usePiControl((s) => s.activeSandboxId);
  const setActiveSandbox = usePiControl((s) => s.setActiveSandbox);
  const startSandbox = usePiControl((s) => s.startSandbox);
  const stopSandbox = usePiControl((s) => s.stopSandbox);
  const removeSandbox = usePiControl((s) => s.removeSandbox);
  const createWorkspaceSession = usePiControl((s) => s.createWorkspaceSession);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const status = SANDBOX_STATUS[sandbox.status] ?? SANDBOX_STATUS.stopped!;

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
    setRebuilding(true);
    try {
      const { sandbox: rebuilt } = await api.rebuildSandbox(sandbox.id);
      usePiControl.setState((s) => ({ sandboxes: { ...s.sandboxes, [sandbox.id]: rebuilt } }));
    } catch (e) {
      console.error(e);
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <li className={`sandbox-node ${sandbox.id === activeSandboxId ? "active" : ""}`}>
      <div className="sandbox-row">
        <button className="sandbox-main" onClick={() => setActiveSandbox(sandbox.id)}>
          <span className={`status-dot ${status.cls}`}>{status.dot}</span>
          <span className="sandbox-name">{sandbox.name}</span>
          <span className="sandbox-profile">{sandbox.securityProfile}</span>
        </button>
        <span className="sandbox-actions">
          <button
            className="btn btn-icon"
            title="New Pi session"
            disabled={busy || sandbox.status !== "running"}
            onClick={() => void act(() => createWorkspaceSession(sandbox.id))}
          >
            +
          </button>
          {sandbox.status === "running" ? (
            <button className="btn btn-icon" title="Stop" disabled={busy} onClick={() => void act(() => stopSandbox(sandbox.id))}>
              ■
            </button>
          ) : (
            <button
              className="btn btn-icon"
              title="Start"
              disabled={busy || sandbox.status === "starting"}
              onClick={() => void act(() => startSandbox(sandbox.id))}
            >
              ▶
            </button>
          )}
          <button
            className="btn btn-icon"
            title="Rebuild environment (preserves /workspace + volumes)"
            disabled={busy || rebuilding || sandbox.status === "building"}
            onClick={() => void rebuild()}
          >
            {rebuilding ? "…" : "⟳"}
          </button>
          {confirmRemove ? (
            <button
              className="btn btn-icon btn-danger"
              title="Confirm remove"
              onClick={() => void act(() => removeSandbox(sandbox.id))}
            >
              ✓
            </button>
          ) : (
            <button className="btn btn-icon" title="Remove container" onClick={() => setConfirmRemove(true)}>
              ✕
            </button>
          )}
        </span>
      </div>
      {sandbox.hostPath && <div className="sandbox-path">{sandbox.hostPath}</div>}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace node (folder)                                             */
/* ------------------------------------------------------------------ */

function WorkspaceNode({ workspace }: { workspace: WorkspaceInfo }) {
  const sandboxes = usePiControl((s) => s.sandboxes);
  const sandboxOrder = usePiControl((s) => s.sandboxOrder);
  const activeWorkspaceId = usePiControl((s) => s.activeWorkspaceId);
  const setActiveWorkspace = usePiControl((s) => s.setActiveWorkspace);
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);

  const workspaceSandboxes = sandboxOrder.filter((id) => sandboxes[id]?.workspaceId === workspace.id);

  return (
    <li className={`project-node ${workspace.id === activeWorkspaceId ? "active" : ""}`}>
      <div className="project-row">
        <button
          className="project-main"
          onClick={() => {
            setActiveWorkspace(workspace.id);
            setExpanded((v) => !v);
          }}
        >
          <span className="project-caret">{expanded ? "▾" : "▸"}</span>
          <span className="project-name">{workspace.name}</span>
        </button>
        <span className="project-actions">
          {workspaceSandboxes.length === 0 && (
            <button className="btn btn-icon" title="Create the sandbox container" onClick={() => setAdding((v) => !v)}>
              +
            </button>
          )}
        </span>
      </div>
      <div className="workspace-path">{workspace.hostRootPath}</div>
      {expanded && (
        <ul className="sandbox-list">
          {workspaceSandboxes.map((id) => {
            const sandbox = sandboxes[id];
            return sandbox ? <SandboxNode key={id} sandbox={sandbox} /> : null;
          })}
          {adding && <AddSandboxForm workspace={workspace} onDone={() => setAdding(false)} />}
        </ul>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Sandbox panel                                                       */
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

  const runningSandbox = Object.values(sandboxes).find((sb) => sb.status === "running");

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
          <p className="sidebar-empty">
            No workspaces yet. Add one — it will be created inside the workspace root.
          </p>
        ) : (
          <ul className="project-list">
            {workspaceOrder.map((id) => {
              const workspace = workspaces[id];
              return workspace ? <WorkspaceNode key={id} workspace={workspace} /> : null;
            })}
            {addingWorkspace && <AddWorkspaceForm onDone={() => setAddingWorkspace(false)} />}
          </ul>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Sessions</span>
          <button
            className="btn btn-small"
            disabled={!runningSandbox}
            title={runningSandbox ? "New real Pi session in the running sandbox" : "Start a sandbox first"}
            onClick={() => void newSession()}
          >
            + New
          </button>
        </div>
        {!runningSandbox && <p className="sidebar-empty">Start a sandbox (▶) to create real Pi sessions.</p>}
        {sessionError && <div className="form-error">{sessionError}</div>}
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
                    {session.workspaceId ? (
                      <span className="session-badge">sandbox</span>
                    ) : (
                      <span className="session-badge mock">mock</span>
                    )}
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
