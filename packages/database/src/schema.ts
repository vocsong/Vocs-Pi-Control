/**
 * Pi Control control-plane schema (SQLite).
 *
 * This database stores Pi Control metadata only — never Pi transcript
 * storage (see ADR-0009). Native Pi sessions remain the source of truth for
 * conversation state.
 */

import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

const iso = () => text("created_at").notNull();

export const machines = sqliteTable("machines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["local", "remote"] }).notNull().default("local"),
  hostname: text("hostname").notNull(),
  platform: text("platform").notNull(),
  status: text("status").notNull().default("online"),
  capabilitiesJson: text("capabilities_json").notNull().default("{}"),
  createdAt: iso(),
  lastSeenAt: text("last_seen_at"),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    machineId: text("machine_id")
      .notNull()
      .references(() => machines.id),
    name: text("name").notNull(),
    hostRootPath: text("host_root_path").notNull(),
    gitRepositoryRoot: text("git_repository_root"),
    createdAt: iso(),
    lastOpenedAt: text("last_opened_at"),
  },
  (t) => [index("projects_machine_idx").on(t.machineId)],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    machineId: text("machine_id")
      .notNull()
      .references(() => machines.id),
    name: text("name").notNull(),
    hostPath: text("host_path").notNull(),
    containerWorkspacePath: text("container_workspace_path").notNull().default("/workspace"),
    kind: text("kind", { enum: ["main", "worktree", "directory"] }).notNull().default("main"),
    gitBranch: text("git_branch"),
    gitWorktreePath: text("git_worktree_path"),
    securityProfile: text("security_profile", { enum: ["standard", "restricted", "trusted"] })
      .notNull()
      .default("standard"),
    sandboxId: text("sandbox_id"),
    createdAt: iso(),
    archivedAt: text("archived_at"),
  },
  (t) => [index("workspaces_project_idx").on(t.projectId)],
);

export const sandboxes = sqliteTable(
  "sandboxes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    runtime: text("runtime").notNull().default("podman"),
    containerName: text("container_name").notNull(),
    containerId: text("container_id"),
    imageRef: text("image_ref").notNull(),
    state: text("state").notNull(),
    securityProfile: text("security_profile").notNull().default("standard"),
    configJson: text("config_json").notNull().default("{}"),
    createdAt: iso(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("sandboxes_workspace_idx").on(t.workspaceId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id),
    parentSessionId: text("parent_session_id"),
    nativePiSessionId: text("native_pi_session_id"),
    nativePiSessionPath: text("native_pi_session_path"),
    title: text("title").notNull().default("New session"),
    role: text("role"),
    status: text("status").notNull().default("starting"),
    model: text("model"),
    thinkingLevel: text("thinking_level"),
    createdAt: iso(),
    updatedAt: text("updated_at").notNull(),
    lastActivityAt: text("last_activity_at"),
  },
  (t) => [index("sessions_workspace_idx").on(t.workspaceId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    parentTaskId: text("parent_task_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    assignedSessionId: text("assigned_session_id"),
    createdAt: iso(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("tasks_workspace_idx").on(t.workspaceId)],
);

export const processes = sqliteTable(
  "processes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    command: text("command").notNull(),
    cwd: text("cwd").notNull(),
    status: text("status").notNull(),
    pid: integer("pid"),
    startedAt: iso(),
    exitedAt: text("exited_at"),
    exitCode: integer("exit_code"),
  },
  (t) => [index("processes_workspace_idx").on(t.workspaceId)],
);

export const terminals = sqliteTable(
  "terminals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name"),
    state: text("state").notNull().default("open"),
    createdAt: iso(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("terminals_workspace_idx").on(t.workspaceId)],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: text("session_id").references(() => sessions.id),
    kind: text("kind").notNull(),
    path: text("path"),
    sizeBytes: integer("size_bytes"),
    createdAt: iso(),
  },
  (t) => [index("artifacts_workspace_idx").on(t.workspaceId)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const plugins = sqliteTable("plugins", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  permissionsJson: text("permissions_json").notNull().default("[]"),
  installedAt: iso(),
});

export const pluginPermissions = sqliteTable(
  "plugin_permissions",
  {
    id: text("id").primaryKey(),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id),
    permission: text("permission").notNull(),
    grantedAt: iso(),
    reason: text("reason"),
  },
  (t) => [index("plugin_permissions_plugin_idx").on(t.pluginId)],
);

export const traces = sqliteTable(
  "traces",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: text("session_id").references(() => sessions.id),
    parentId: text("parent_id"),
    type: text("type").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status").notNull(),
    metadataJson: text("metadata_json"),
  },
  (t) => [index("traces_workspace_idx").on(t.workspaceId)],
);

/** Per-scope event sequence checkpoints for reconnect/replay (plan §26). */
export const eventCheckpoints = sqliteTable(
  "event_checkpoints",
  {
    scope: text("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    lastSeq: integer("last_seq").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.scopeId] })],
);

export const securityGrants = sqliteTable(
  "security_grants",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    capability: text("capability").notNull(),
    grantType: text("grant_type"),
    grantedAt: iso(),
    revokedAt: text("revoked_at"),
    reason: text("reason"),
  },
  (t) => [index("security_grants_workspace_idx").on(t.workspaceId)],
);
