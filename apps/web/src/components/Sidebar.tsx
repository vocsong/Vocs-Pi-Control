import { useState } from "react";
import type { ProjectInfo, WorkspaceInfo } from "@pi-control/protocol";
import { usePiControl } from "../store";

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

const WORKSPACE_STATUS: Record<string, { dot: string; cls: string }> = {
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

function AddProjectForm({ onDone }: { onDone: () => void }) {
  const createProject = usePiControl((s) => s.createProject);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createProject(name.trim(), path.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-form">
      <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        placeholder="Folder path (e.g. C:/Projects/my-app)"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button className="btn btn-small" onClick={() => void submit()} disabled={busy}>
          Add project
        </button>
        <button className="btn btn-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddWorkspaceForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const createWorkspace = usePiControl((s) => s.createWorkspace);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createWorkspace(name.trim(), path.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-form">
      <input placeholder="Workspace name (e.g. main)" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        placeholder="Folder path (e.g. C:/Projects/my-app)"
        value={path}
        onChange={(e) => setPath(e.target.value)}
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

/* ------------------------------------------------------------------ */
/* Workspace node                                                      */
/* ------------------------------------------------------------------ */

function WorkspaceNode({ workspace }: { workspace: WorkspaceInfo }) {
  const activeWorkspaceId = usePiControl((s) => s.activeWorkspaceId);
  const setActiveWorkspace = usePiControl((s) => s.setActiveWorkspace);
  const startWorkspace = usePiControl((s) => s.startWorkspace);
  const stopWorkspace = usePiControl((s) => s.stopWorkspace);
  const removeWorkspace = usePiControl((s) => s.removeWorkspace);
  const createWorkspaceSession = usePiControl((s) => s.createWorkspaceSession);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const status = WORKSPACE_STATUS[workspace.status] ?? WORKSPACE_STATUS.stopped!;

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

  return (
    <li className={`workspace-node ${workspace.id === activeWorkspaceId ? "active" : ""}`}>
      <div className="workspace-row">
        <button className="workspace-main" onClick={() => setActiveWorkspace(workspace.id)}>
          <span className={`status-dot ${status.cls}`}>{status.dot}</span>
          <span className="workspace-name">{workspace.name}</span>
          <span className="workspace-profile">{workspace.securityProfile}</span>
        </button>
        <span className="workspace-actions">
          <button
            className="btn btn-icon"
            title="New Pi session"
            disabled={busy}
            onClick={() => void act(() => createWorkspaceSession(workspace.id))}
          >
            +
          </button>
          {workspace.status === "running" ? (
            <button className="btn btn-icon" title="Stop" disabled={busy} onClick={() => void act(() => stopWorkspace(workspace.id))}>
              ■
            </button>
          ) : (
            <button
              className="btn btn-icon"
              title="Start"
              disabled={busy || workspace.status === "starting"}
              onClick={() => void act(() => startWorkspace(workspace.id))}
            >
              ▶
            </button>
          )}
          {confirmRemove ? (
            <button
              className="btn btn-icon btn-danger"
              title="Confirm remove"
              onClick={() => void act(() => removeWorkspace(workspace.id))}
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
      {workspace.hostPath && <div className="workspace-path">{workspace.hostPath}</div>}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Project node                                                        */
/* ------------------------------------------------------------------ */

function ProjectNode({ project }: { project: ProjectInfo }) {
  const workspaces = usePiControl((s) => s.workspaces);
  const workspaceOrder = usePiControl((s) => s.workspaceOrder);
  const activeProjectId = usePiControl((s) => s.activeProjectId);
  const setActiveProject = usePiControl((s) => s.setActiveProject);
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);

  const projectWorkspaces = workspaceOrder.filter((id) => workspaces[id]?.projectId === project.id);

  return (
    <li className={`project-node ${project.id === activeProjectId ? "active" : ""}`}>
      <div className="project-row">
        <button
          className="project-main"
          onClick={() => {
            setActiveProject(project.id);
            setExpanded((v) => !v);
          }}
        >
          <span className="project-caret">{expanded ? "▾" : "▸"}</span>
          <span className="project-name">{project.name}</span>
        </button>
        <span className="project-actions">
          <button className="btn btn-icon" title="Add workspace" onClick={() => setAdding((v) => !v)}>
            +
          </button>
        </span>
      </div>
      {expanded && (
        <ul className="workspace-list">
          {projectWorkspaces.map((id) => {
            const workspace = workspaces[id];
            return workspace ? <WorkspaceNode key={id} workspace={workspace} /> : null;
          })}
          {adding && <AddWorkspaceForm projectId={project.id} onDone={() => setAdding(false)} />}
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
        <span>Sandbox: {sandbox.runtime}</span>
        <span className="project-caret">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="sandbox-body">
          <div className="sandbox-line">
            {sandbox.detected ? `Podman ${sandbox.version ?? ""}`.trim() : "Podman not detected"}
          </div>
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
  const projects = usePiControl((s) => s.projects);
  const projectOrder = usePiControl((s) => s.projectOrder);
  const [addingProject, setAddingProject] = useState(false);

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Projects</span>
          <button className="btn btn-small" onClick={() => setAddingProject((v) => !v)}>
            + Add
          </button>
        </div>
        {projectOrder.length === 0 && !addingProject ? (
          <p className="sidebar-empty">No projects yet. Add a folder to sandbox it.</p>
        ) : (
          <ul className="project-list">
            {projectOrder.map((id) => {
              const project = projects[id];
              return project ? <ProjectNode key={id} project={project} /> : null;
            })}
            {addingProject && <AddProjectForm onDone={() => setAddingProject(false)} />}
          </ul>
        )}
      </div>

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
                    {session.workspaceId && <span className="session-badge">sandbox</span>}
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
