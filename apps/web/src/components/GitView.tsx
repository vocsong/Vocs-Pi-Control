import { useCallback, useEffect, useState } from "react";
import type { AgentGitBranch, AgentGitChange, AgentGitLogEntry } from "@pi-control/protocol";
import { usePiControl } from "../store";
import { api } from "../api";

interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  changes: AgentGitChange[];
}

type SubTab = "changes" | "history" | "branches" | "worktrees";

const INDEX_LABEL: Record<string, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "unmerged",
};

function labelOf(code: string): string {
  return INDEX_LABEL[code] ?? (code === " " || code === "?" ? "" : code);
}

export function GitView() {
  const activeSandboxId = usePiControl((s) => s.activeSandboxId);
  const sandboxes = usePiControl((s) => s.sandboxes);
  const workspaces = usePiControl((s) => s.workspaces);
  const sandbox = activeSandboxId ? sandboxes[activeSandboxId] : undefined;

  const [sub, setSub] = useState<SubTab>("changes");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState("");
  const [diffStaged, setDiffStaged] = useState(false);
  const [log, setLog] = useState<AgentGitLogEntry[]>([]);
  const [branches, setBranches] = useState<{ current: string; branches: AgentGitBranch[] } | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [newWorktree, setNewWorktree] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!activeSandboxId) return;
    try {
      const event = await api.gitStatus(activeSandboxId);
      setStatus(event as GitStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeSandboxId]);

  const loadLog = useCallback(async () => {
    if (!activeSandboxId) return;
    try {
      setLog((await api.gitLog(activeSandboxId)) as AgentGitLogEntry[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeSandboxId]);

  const loadBranches = useCallback(async () => {
    if (!activeSandboxId) return;
    try {
      setBranches((await api.gitBranches(activeSandboxId)) as { current: string; branches: AgentGitBranch[] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeSandboxId]);

  useEffect(() => {
    setStatus(null);
    setLog([]);
    setDiff("");
    setCommitMsg("");
    if (activeSandboxId) {
      void loadStatus();
      void loadLog();
      void loadBranches();
    }
  }, [activeSandboxId, loadStatus, loadLog, loadBranches]);

  const showDiff = async (staged: boolean) => {
    if (!activeSandboxId) return;
    setDiffStaged(staged);
    try {
      const event = await api.gitDiff(activeSandboxId, staged);
      setDiff((event as { diff: string }).diff);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await loadStatus();
      await loadLog();
      await loadBranches();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!sandbox) {
    return <div className="files-empty">Start a sandbox to see its Git state.</div>;
  }

  const workspace = sandbox.workspaceId ? workspaces[sandbox.workspaceId] : undefined;

  return (
    <div className="git-view">
      <div className="git-tabs">
        {(["changes", "history", "branches", "worktrees"] as SubTab[]).map((t) => (
          <button key={t} className={`tab ${sub === t ? "active" : ""}`} onClick={() => setSub(t)}>
            {t}
          </button>
        ))}
        {status && (
          <span className="git-branch-label">
            {status.branch}
            {status.ahead > 0 && ` ↑${status.ahead}`}
            {status.behind > 0 && ` ↓${status.behind}`}
          </span>
        )}
      </div>

      {error && <div className="form-error git-error">{error}</div>}

      {sub === "changes" && (
        <div className="git-changes">
          <div className="git-changes-list">
            {status && status.changes.length === 0 && <div className="files-empty">Working tree clean.</div>}
            {status?.changes.map((change) => (
              <div key={change.path} className="git-change-row">
                <span className="git-status-badge">
                  {change.untracked ? "??" : `${labelOf(change.index) || "·"}${labelOf(change.worktree) || "·"}`}
                </span>
                <span className="git-change-path" title={change.path}>
                  {change.path}
                </span>
                <span className="git-change-actions">
                  {change.staged ? (
                    <button className="btn btn-small" disabled={busy} onClick={() => void act(() => api.gitUnstage(activeSandboxId!, [change.path]))}>
                      Unstage
                    </button>
                  ) : (
                    <button className="btn btn-small" disabled={busy} onClick={() => void act(() => api.gitStage(activeSandboxId!, [change.path]))}>
                      Stage
                    </button>
                  )}
                </span>
              </div>
            ))}
            {status && status.changes.length > 0 && (
              <div className="git-changes-actions">
                <button className="btn btn-small" disabled={busy} onClick={() => void act(() => api.gitStage(activeSandboxId!, status.changes.filter((c) => !c.staged).map((c) => c.path)))}>
                  Stage all
                </button>
                <div className="git-commit-box">
                  <input
                    placeholder="Commit message"
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && commitMsg.trim() && void act(() => api.gitCommit(activeSandboxId!, commitMsg.trim()))}
                  />
                  <button
                    className="btn btn-small btn-primary"
                    disabled={busy || !commitMsg.trim()}
                    onClick={() => void act(() => api.gitCommit(activeSandboxId!, commitMsg.trim()))}
                  >
                    Commit
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="git-diff-pane">
            <div className="git-diff-toolbar">
              <button className={`btn btn-small ${!diffStaged ? "active" : ""}`} onClick={() => void showDiff(false)}>
                Unstaged
              </button>
              <button className={`btn btn-small ${diffStaged ? "active" : ""}`} onClick={() => void showDiff(true)}>
                Staged
              </button>
            </div>
            <pre className="git-diff">{diff || "(select a diff view)"}</pre>
          </div>
        </div>
      )}

      {sub === "history" && (
        <div className="git-log">
          {log.map((entry) => (
            <div key={entry.hash} className="git-log-row">
              <span className="git-log-hash">{entry.hash.slice(0, 8)}</span>
              <span className="git-log-subject">{entry.subject}</span>
              <span className="git-log-meta">
                {entry.author} · {new Date(entry.date).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {sub === "branches" && (
        <div className="git-branches">
          <div className="git-branch-create">
            <input placeholder="New branch name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
            <button
              className="btn btn-small"
              disabled={busy || !newBranch.trim()}
              onClick={() => void act(() => api.gitBranchCreate(activeSandboxId!, newBranch.trim()))}
            >
              Create + checkout
            </button>
          </div>
          {branches?.branches.map((b) => (
            <div key={b.name} className="git-log-row">
              <span className="git-log-hash">{b.current ? "●" : "○"}</span>
              <span className="git-log-subject">{b.name}</span>
              {b.current && <span className="git-branch-current">current</span>}
            </div>
          ))}
        </div>
      )}

      {sub === "worktrees" && (
        <div className="git-worktrees">
          <div className="git-branch-create">
            <input placeholder="Worktree name (e.g. feature-auth)" value={newWorktree} onChange={(e) => setNewWorktree(e.target.value)} />
            <button
              className="btn btn-small btn-primary"
              disabled={busy || !newWorktree.trim() || !workspace}
              title={workspace ? "Creates a git worktree + a new sandbox" : "Workspace missing"}
              onClick={() => {
                if (!workspace) return;
                void act(async () => {
                  await api.createWorktree(workspace.id, { name: newWorktree.trim() });
                  setNewWorktree("");
                });
              }}
            >
              Create worktree + workspace
            </button>
          </div>
          <p className="git-hint">
            Independent implementations get their own Git worktree, workspace, and sandbox container
            (Invariant D).
          </p>
        </div>
      )}
    </div>
  );
}
