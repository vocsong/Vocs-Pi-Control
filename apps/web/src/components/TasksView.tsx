import { useEffect, useState } from "react";
import type { TaskInfo, TaskStatus } from "@pi-control/protocol";
import { usePiControl } from "../store";
import { api } from "../api";

const STATUSES: TaskStatus[] = ["todo", "running", "blocked", "done", "failed"];

export function TasksView() {
  const activeWorkspaceId = usePiControl((s) => s.activeWorkspaceId);
  const workspaces = usePiControl((s) => s.workspaces);
  const sessions = usePiControl((s) => s.sessions);
  const workspace = activeWorkspaceId ? workspaces[activeWorkspaceId] : undefined;

  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!activeWorkspaceId) return;
    try {
      const { tasks: rows } = await api.listTasks(activeWorkspaceId);
      setTasks(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    setTasks([]);
    if (activeWorkspaceId) void load();
  }, [activeWorkspaceId]);

  const create = async () => {
    if (!activeWorkspaceId || !title.trim()) return;
    try {
      await api.createTask(activeWorkspaceId, { title: title.trim() });
      setTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setStatus = async (taskId: string, status: TaskStatus) => {
    if (!activeWorkspaceId) return;
    try {
      await api.updateTask(taskId, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const assign = async (taskId: string, sessionId: string | null) => {
    try {
      await api.updateTask(taskId, { assignedSessionId: sessionId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!workspace) {
    return <div className="files-empty">Select a workspace to manage tasks.</div>;
  }

  const workspaceSessions = Object.values(sessions).filter((s) => s.workspaceId === workspace.id);

  return (
    <div className="tasks-view">
      <div className="tasks-create">
        <input
          placeholder="Task title (e.g. Implement auth flow)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
        />
        <button className="btn btn-small btn-primary" disabled={!title.trim()} onClick={() => void create()}>
          Add task
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="tasks-list">
        {tasks.length === 0 && <div className="files-empty">No tasks.</div>}
        {tasks.map((task) => (
          <div key={task.id} className={`task-row task-${task.status}`}>
            <span className="task-title">{task.title}</span>
            {task.description && <span className="task-desc">{task.description}</span>}
            <span className="task-controls">
              {STATUSES.map((status) => (
                <button
                  key={status}
                  className={`btn btn-small ${task.status === status ? "active" : ""}`}
                  onClick={() => void setStatus(task.id, status)}
                >
                  {status}
                </button>
              ))}
              <select
                className="session-control"
                value={task.assignedSessionId ?? ""}
                onChange={(e) => void assign(task.id, e.target.value || null)}
                title="Assign to a session"
              >
                <option value="">unassigned</option>
                {workspaceSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
