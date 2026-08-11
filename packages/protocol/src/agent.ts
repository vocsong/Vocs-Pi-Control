/**
 * Workspace-agent protocol (control server <-> pi-control-workspace-agent).
 *
 * The control server connects OUT to the agent: the workspace container
 * publishes `127.0.0.1:<hostPort>:<agentPort>` at creation, and the agent
 * listens on the agent port inside the sandbox (plan §11.3, ADR-0006).
 * Authentication is a random per-sandbox token presented as
 * `Authorization: Bearer <token>` on the WebSocket upgrade; the server
 * rejects connections without a valid token before any message is read.
 *
 * The agent is the process/terminal/session owner inside the sandbox and
 * survives control-server restarts; the server reconnects and re-syncs.
 */

export const AGENT_PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Server -> agent commands                                            */
/* ------------------------------------------------------------------ */

export const AGENT_COMMAND_TYPES = [
  "agent.hello",
  "agent.ping",
  "agent.exec",
  "agent.process.spawn",
  "agent.process.kill",
  "agent.process.list",
  "agent.session.create",
  "agent.session.resume",
  "agent.session.prompt",
  "agent.session.steer",
  "agent.session.followUp",
  "agent.session.abort",
  "agent.session.compact",
  "agent.session.setModel",
  "agent.session.setThinkingLevel",
  "agent.session.dispose",
  "agent.session.list",
  "agent.file.list",
  "agent.file.read",
  "agent.file.write",
  "agent.file.mkdir",
  "agent.file.remove",
  "agent.file.rename",
  "agent.git.status",
  "agent.git.diff",
  "agent.git.stage",
  "agent.git.unstage",
  "agent.git.commit",
  "agent.git.branches",
  "agent.git.branchCreate",
  "agent.git.log",
  "agent.shutdown",
] as const;

export type AgentCommandType = (typeof AGENT_COMMAND_TYPES)[number];

export interface AgentCommand<T = unknown> {
  id: string;
  type: AgentCommandType;
  payload: T;
}

export interface AgentHelloPayload {
  workspaceId: string;
  agentVersion: string;
  protocolVersion: number;
}

export interface AgentExecRequest {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface AgentProcessSpawnRequest {
  name?: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface AgentSessionCreateRequest {
  /** Control-plane session id (server-generated, browser-facing). */
  sessionId: string;
  title?: string;
  model?: string;
  thinkingLevel?: string;
  /** Provider credential env vars (V1 boundary — scrubbing is Phase 7+). */
  env?: Record<string, string>;
}

export interface AgentSessionResumeRequest {
  sessionId: string;
  nativeSessionPath: string;
  env?: Record<string, string>;
}

export interface AgentSessionPromptRequest {
  sessionId: string;
  text: string;
}

export interface AgentSessionControlRequest {
  sessionId: string;
  model?: string;
  level?: string;
}

export interface AgentSessionInfo {
  sessionId: string;
  nativePiSessionId?: string;
  nativePiSessionPath?: string;
  /** Native session file (for resume). */
  sessionFile?: string;
  title: string;
  status: string;
  model?: string;
  thinkingLevel?: string;
}

/* ------------------------------------------------------------------ */
/* File service (Phase 6)                                              */
/* ------------------------------------------------------------------ */

export interface AgentFileEntry {
  name: string;
  /** Path relative to the workspace root (no leading slash). */
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  mtimeMs: number;
}

export interface AgentFileListRequest {
  /** Directory relative to the workspace root; empty = root. */
  path?: string;
}

export interface AgentFileListPayload {
  entries: AgentFileEntry[];
  commandId?: string;
}

export interface AgentFileReadRequest {
  path: string;
  /** Cap returned content; larger files are truncated (or base64 for binary). */
  maxBytes?: number;
}

export interface AgentFileReadPayload {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  truncated: boolean;
  size: number;
  commandId?: string;
}

export interface AgentFileWriteRequest {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface AgentFileMkdirRequest {
  path: string;
  recursive?: boolean;
}

export interface AgentFileRemoveRequest {
  path: string;
  recursive?: boolean;
}

export interface AgentFileRenameRequest {
  from: string;
  to: string;
}

export interface AgentFileOkPayload {
  ok: true;
  path: string;
  bytes?: number;
  commandId?: string;
}

/* ------------------------------------------------------------------ */
/* Git service (Phase 7)                                               */
/* ------------------------------------------------------------------ */

export interface AgentGitChange {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  untracked: boolean;
}

export interface AgentGitStatusPayload {
  branch: string;
  ahead: number;
  behind: number;
  changes: AgentGitChange[];
  commandId?: string;
}

export interface AgentGitDiffPayload {
  diff: string;
  commandId?: string;
}

export interface AgentGitStageRequest {
  paths: string[];
}

export interface AgentGitCommitRequest {
  message: string;
}

export interface AgentGitCommitPayload {
  hash: string;
  commandId?: string;
}

export interface AgentGitBranch {
  name: string;
  current: boolean;
}

export interface AgentGitBranchesPayload {
  current: string;
  branches: AgentGitBranch[];
  commandId?: string;
}

export interface AgentGitBranchCreateRequest {
  name: string;
  from?: string;
}

export interface AgentGitLogEntry {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface AgentGitLogPayload {
  entries: AgentGitLogEntry[];
  commandId?: string;
}

/* ------------------------------------------------------------------ */
/* Agent -> server events                                              */
/* ------------------------------------------------------------------ */

export const AGENT_EVENT_TYPES = [
  "agent.ready",
  "agent.health",
  "agent.ok",
  "agent.exec.output",
  "agent.exec.exit",
  "agent.process.started",
  "agent.process.output",
  "agent.process.exited",
  "agent.process.list",
  "agent.session.created",
  "agent.session.event",
  "agent.session.list",
  "agent.file.list",
  "agent.file.read",
  "agent.file.ok",
  "agent.git.status",
  "agent.git.diff",
  "agent.git.commit",
  "agent.git.branches",
  "agent.git.log",
  "agent.git.ok",
  "agent.error",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export interface AgentEvent<T = unknown> {
  type: AgentEventType;
  payload: T;
}

export interface AgentReadyPayload {
  workspaceId: string;
  agentVersion: string;
  protocolVersion: number;
  processes: AgentProcessInfo[];
  /** Live Pi sessions (re-synced on reconnect). */
  sessions?: AgentSessionInfo[];
}

export interface AgentHealthPayload {
  workspaceId: string;
  uptimeMs: number;
  memory: { rssBytes: number; heapUsedBytes: number };
  cpuPercent?: number;
  processCount: number;
  agentVersion: string;
}

export interface AgentProcessInfo {
  id: string;
  name: string;
  command: string;
  cwd: string;
  status: "starting" | "running" | "exited" | "error";
  pid?: number;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number;
}

export interface AgentExecOutputPayload {
  commandId: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface AgentExecExitPayload {
  commandId: string;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  stdout: string;
  stderr: string;
}

export interface AgentProcessStartedPayload {
  process: AgentProcessInfo;
  /** Present when this event is the response to an agent.process.spawn command. */
  commandId?: string;
}

export interface AgentOkPayload {
  commandId: string;
}

export interface AgentProcessOutputPayload {
  processId: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface AgentProcessExitedPayload {
  processId: string;
  exitCode: number;
}

export interface AgentProcessListPayload {
  processes: AgentProcessInfo[];
  /** Present when this event is the response to an agent.process.list command. */
  commandId?: string;
}

export interface AgentSessionCreatedPayload {
  sessionId: string;
  nativePiSessionId?: string;
  nativePiSessionPath?: string;
  model?: string;
  thinkingLevel?: string;
  commandId?: string;
}

/**
 * A normalized Pi driver event forwarded as a protocol envelope init.
 * The server publishes it with a sequence number (single mapping lives in
 * packages/pi-driver/src/events.ts).
 */
export interface AgentSessionEventPayload {
  sessionId: string;
  envelope: {
    scope: "session";
    sessionId: string;
    type: string;
    payload: unknown;
  };
}

export interface AgentSessionListPayload {
  sessions: AgentSessionInfo[];
  commandId?: string;
}

export interface AgentErrorPayload {
  message: string;
  commandId?: string;
}
