import type { ProjectInfo, SessionInfo, WorkspaceInfo } from "@pi-control/protocol";

export interface HealthInfo {
  status: string;
  service: string;
  version: string;
  uptimeMs: number;
  runtime: string;
  database: string;
  sandbox?: {
    runtime: string;
    detected: boolean;
    rootlessAvailable: boolean;
    machineRequired: boolean;
    machineConfigured: boolean;
    machineRunning: boolean;
    version?: string;
    messages: string[];
  };
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => json<HealthInfo>("/api/health"),

  listSessions: () => json<{ sessions: SessionInfo[] }>("/api/sessions"),

  createSession: (body: { title?: string } = {}) =>
    json<{ session: SessionInfo }>("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  deleteSession: (sessionId: string) => json<{ ok: boolean }>(`/api/sessions/${sessionId}`, { method: "DELETE" }),

  listFiles: (workspaceId: string, path = "") =>
    json<{ entries: Array<{ name: string; path: string; type: string; size: number; mtimeMs: number }> }>(
      `/api/workspaces/${workspaceId}/files?path=${encodeURIComponent(path)}`,
    ),

  readFile: (workspaceId: string, path: string) =>
    json<{ file: { content: string; encoding: "utf8" | "base64"; truncated: boolean; size: number } }>(
      `/api/workspaces/${workspaceId}/file?path=${encodeURIComponent(path)}`,
    ),

  writeFile: (workspaceId: string, path: string, content: string, encoding: "utf8" | "base64" = "utf8") =>
    json<{ result: { ok: boolean } }>(`/api/workspaces/${workspaceId}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content, encoding }),
    }),

  mkdirFile: (workspaceId: string, path: string) =>
    json<{ ok: boolean }>(`/api/workspaces/${workspaceId}/file/mkdir`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  removeFile: (workspaceId: string, path: string, recursive = false) =>
    json<{ ok: boolean }>(`/api/workspaces/${workspaceId}/file/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, recursive }),
    }),

  renameFile: (workspaceId: string, from: string, to: string) =>
    json<{ ok: boolean }>(`/api/workspaces/${workspaceId}/file/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    }),

  listProjects: () => json<{ projects: ProjectInfo[] }>("/api/projects"),

  createProject: (body: { name: string; hostRootPath: string }) =>
    json<{ project: ProjectInfo }>("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  listWorkspaces: (projectId?: string) =>
    json<{ workspaces: WorkspaceInfo[] }>(projectId ? `/api/projects/${projectId}/workspaces` : "/api/workspaces"),

  createWorkspace: (
    projectId: string,
    body: { name: string; hostPath: string; securityProfile?: string; imageRef?: string },
  ) =>
    json<{ workspace: WorkspaceInfo }>(`/api/projects/${projectId}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  startWorkspace: (workspaceId: string) =>
    json<{ workspace: WorkspaceInfo }>(`/api/workspaces/${workspaceId}/start`, { method: "POST" }),

  stopWorkspace: (workspaceId: string) =>
    json<{ workspace: WorkspaceInfo }>(`/api/workspaces/${workspaceId}/stop`, { method: "POST" }),

  removeWorkspace: (workspaceId: string) =>
    json<{ ok: boolean }>(`/api/workspaces/${workspaceId}/remove`, { method: "POST" }),

  createWorkspaceSession: (workspaceId: string, body: { title?: string } = {}) =>
    json<{ session: SessionInfo }>(`/api/workspaces/${workspaceId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  sandboxStatus: () => json<{ status: HealthInfo["sandbox"] }>("/api/sandbox/status"),

  sandboxPrepare: () =>
    json<{ ok: boolean; messages: string[] }>("/api/sandbox/prepare", { method: "POST" }),

  sandboxSelfTest: () =>
    json<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }>("/api/sandbox/self-test", {
      method: "POST",
    }),
};
