import type { AgentProcessInfo, SandboxInfo, SessionInfo, WorkspaceInfo } from "@pi-control/protocol";

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

  listFiles: (sandboxId: string, path = "") =>
    json<{ entries: Array<{ name: string; path: string; type: string; size: number; mtimeMs: number }> }>(
      `/api/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}`,
    ),

  readFile: (sandboxId: string, path: string) =>
    json<{ file: { content: string; encoding: "utf8" | "base64"; truncated: boolean; size: number } }>(
      `/api/sandboxes/${sandboxId}/file?path=${encodeURIComponent(path)}`,
    ),

  writeFile: (sandboxId: string, path: string, content: string, encoding: "utf8" | "base64" = "utf8") =>
    json<{ result: { ok: boolean } }>(`/api/sandboxes/${sandboxId}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content, encoding }),
    }),

  mkdirFile: (sandboxId: string, path: string) =>
    json<{ ok: boolean }>(`/api/sandboxes/${sandboxId}/file/mkdir`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  removeFile: (sandboxId: string, path: string, recursive = false) =>
    json<{ ok: boolean }>(`/api/sandboxes/${sandboxId}/file/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, recursive }),
    }),

  renameFile: (sandboxId: string, from: string, to: string) =>
    json<{ ok: boolean }>(`/api/sandboxes/${sandboxId}/file/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    }),

  searchFiles: (sandboxId: string, query: string, max = 30) =>
    json<{ matches: string[] }>(
      `/api/sandboxes/${sandboxId}/file/search?q=${encodeURIComponent(query)}&max=${max}`,
    ),
  gitStatus: (sandboxId: string) => json<unknown>(`/api/sandboxes/${sandboxId}/git/status`),

  gitDiff: (sandboxId: string, staged = false) =>
    json<unknown>(`/api/sandboxes/${sandboxId}/git/diff?staged=${staged ? 1 : 0}`),

  gitStage: (sandboxId: string, paths: string[]) =>
    json<{ ok: boolean }>(`/api/sandboxes/${sandboxId}/git/stage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths }),
    }),

  gitUnstage: (sandboxId: string, paths: string[]) =>
    json<{ ok: boolean }>(`/api/sandboxes/${sandboxId}/git/unstage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths }),
    }),

  gitCommit: (sandboxId: string, message: string) =>
    json<unknown>(`/api/sandboxes/${sandboxId}/git/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),

  gitBranches: (sandboxId: string) => json<unknown>(`/api/sandboxes/${sandboxId}/git/branches`),

  gitBranchCreate: (sandboxId: string, name: string) =>
    json<{ ok: boolean }>(`/api/sandboxes/${sandboxId}/git/branches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  gitLog: (sandboxId: string) => json<unknown>(`/api/sandboxes/${sandboxId}/git/log`),

  createWorktree: (workspaceId: string, body: { name: string; branch?: string }) =>
    json<{ worktree: { workspaceId: string; worktreePath: string; branch: string } }>(
      `/api/workspaces/${workspaceId}/worktrees`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  listTerminals: (sandboxId: string) => json<{ terminals: unknown[] }>(`/api/sandboxes/${sandboxId}/terminals`),

  listProcesses: (sandboxId: string) =>
    json<{ processes: AgentProcessInfo[] }>(`/api/sandboxes/${sandboxId}/processes`),

  spawnProcess: (
    sandboxId: string,
    body: { name?: string; command: string[]; env?: Record<string, string> },
  ) =>
    json<{ process: AgentProcessInfo }>(`/api/sandboxes/${sandboxId}/processes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  killProcess: (sandboxId: string, processId: string) =>
    json<{ ok: boolean }>(`/api/sandboxes/${sandboxId}/processes/${processId}/kill`, { method: "POST" }),

  listPorts: (sandboxId: string) =>
    json<Array<{ containerPort: number; url: string }>>(`/api/sandboxes/${sandboxId}/ports`),

  sessionCapabilities: (sessionId: string) =>
    json<{ capabilities: Record<string, unknown> }>(`/api/sessions/${sessionId}/capabilities`),

  listModels: (sandboxId: string) =>
    json<{ models: Array<{ provider: string; id: string }> }>(`/api/sandboxes/${sandboxId}/models`),

  setSessionModel: (sessionId: string, model: string) =>
    json<{ ok: boolean }>(`/api/sessions/${sessionId}/model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    }),

  setSessionThinking: (sessionId: string, level: string) =>
    json<{ ok: boolean }>(`/api/sessions/${sessionId}/thinking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level }),
    }),

  compactSession: (sessionId: string) =>
    json<{ ok: boolean }>(`/api/sessions/${sessionId}/compact`, { method: "POST" }),

  listTasks: (sandboxId: string) =>
    json<{ tasks: import("@pi-control/protocol").TaskInfo[] }>(`/api/sandboxes/${sandboxId}/tasks`),

  createTask: (sandboxId: string, body: { title: string; description?: string }) =>
    json<{ task: import("@pi-control/protocol").TaskInfo }>(`/api/sandboxes/${sandboxId}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  updateTask: (taskId: string, body: { status?: string; assignedSessionId?: string | null }) =>
    json<{ task: import("@pi-control/protocol").TaskInfo }>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  listWorkspaces: () => json<{ workspaces: WorkspaceInfo[] }>("/api/workspaces"),

  createWorkspace: (body: { name: string; hostRootPath?: string }) =>
    json<{ workspace: WorkspaceInfo; sandbox: SandboxInfo }>("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  listSandboxes: (workspaceId?: string) =>
    json<{ sandboxes: SandboxInfo[] }>(workspaceId ? `/api/workspaces/${workspaceId}/sandboxes` : "/api/sandboxes"),

  createSandbox: (
    workspaceId: string,
    body: { name?: string; hostPath?: string; securityProfile?: string; profile?: string; imageRef?: string },
  ) =>
    json<{ sandbox: SandboxInfo }>(`/api/workspaces/${workspaceId}/sandboxes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  startSandbox: (sandboxId: string) =>
    json<{ sandbox: SandboxInfo }>(`/api/sandboxes/${sandboxId}/start`, { method: "POST" }),

  stopSandbox: (sandboxId: string) =>
    json<{ sandbox: SandboxInfo }>(`/api/sandboxes/${sandboxId}/stop`, { method: "POST" }),

  rebuildSandbox: (sandboxId: string, profile?: string) =>
    json<{ sandbox: SandboxInfo }>(`/api/sandboxes/${sandboxId}/rebuild`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile ? { profile } : {}),
    }),

  removeSandbox: (sandboxId: string) =>
    json<{ ok: boolean }>(`/api/sandboxes/${sandboxId}/remove`, { method: "POST" }),

  createWorkspaceSession: (sandboxId: string, body: { title?: string } = {}) =>
    json<{ session: SessionInfo }>(`/api/sandboxes/${sandboxId}/sessions`, {
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

  getSettings: () =>
    json<{
      settings: {
        providers: Array<{ key: string; configured: boolean }>;
        defaults: { defaultModel: string | null; defaultThinkingLevel: string | null };
        rootFolder: string | null;
      };
    }>("/api/settings"),

  saveProviderKeys: (keys: Record<string, string>) =>
    json<{ ok: boolean }>("/api/settings/providers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys }),
    }),

  saveDefaults: (body: { defaultModel?: string | null; defaultThinkingLevel?: string | null }) =>
    json<{ ok: boolean }>("/api/settings/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  saveRootFolder: (path: string | null) =>
    json<{ ok: boolean; rootFolder: string | null }>("/api/settings/root", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }),
};
