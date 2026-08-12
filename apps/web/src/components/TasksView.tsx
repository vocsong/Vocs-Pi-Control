import { useCallback, useEffect, useState } from "react";
import type { TaskInfo, TaskStatus } from "@pi-control/protocol";
import { usePiControl } from "../store";
import { api } from "../api";

const STATUSES: TaskStatus[] = ["todo", "running", "blocked", "done", "failed"];

export function TasksView() {
  const activeSandboxId = usePiControl((s) => s.activeSandboxId);
  const sandboxes = usePiControl((s) => s.sandboxes);
  const sessions = usePiControl((s) => s.sessions);
  const sandbox = activeSandboxId ? sandboxes[activeSandboxId] : undefined;

  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeSandboxId) return;
    try {
      const { tasks: rows } = await api.listTasks(activeSandboxId);
      setTasks(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeSandboxId]);

  useEffect(() => {
    setTasks([]);
    if (activeSandboxId) void load();
  }, [activeSandboxId, load]);

  const create = async () => {
    if (!activeSandboxId || !title.trim()) return;
    try {
      await api.createTask(activeSandboxId, { title: title.trim() });
      setTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setStatus = async (taskId: string, status: TaskStatus) => {
    if (!activeSandboxId) return;
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

  if (!sandbox) {
    return <div className="files-empty">Start a sandbox to manage tasks.</div>;
  }

  const sandboxSessions = Object.values(sessions).filter((s) => s.workspaceId === sandbox.id);

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
                {sandboxSessions.map((s) => (
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
