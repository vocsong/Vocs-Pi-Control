/**
 * SandboxManager — control-plane ownership of workspaces and sandbox
 * containers (plan §4, §18, §21).
 *
 * Terminology: a WORKSPACE is a folder/repository under the workspace root
 * (DB table `projects`); a SANDBOX is the container instance of a workspace
 * (DB table `workspaces`); `sandboxes` holds runtime records.
 *
 * The control server owns sandbox lifecycle; Pi agents never receive
 * Podman control (Invariant E). All container operations go through the
 * SandboxRuntime adapter.
 */

import fs from "node:fs";
import net from "node:net";
import crypto from "node:crypto";
import path from "node:path";
import { schema, type Db } from "@pi-control/database";
import { desc, eq, isNull } from "drizzle-orm";
import {
  EVENT_TYPES,
  type SandboxInfo,
  type SandboxStatus,
  type SandboxStatusPayload,
  type WorkspaceInfo,
} from "@pi-control/protocol";
import {
  defaultResources,
  type CreateWorkspaceSandboxSpec,
  type RuntimeDetection,
  type SandboxRuntime,
  type SelfTestResult,
} from "@pi-control/sandbox";
import { newId, nowIso } from "@pi-control/shared";
import type { RealtimeHub } from "../realtime/hub.js";
import type { Logger } from "../logger.js";
import type { AgentManager, AgentEndpoint } from "../agents/agentManager.js";

export interface SandboxManagerOptions {
  db: Db;
  runtime: SandboxRuntime;
  hub: RealtimeHub;
  logger: Logger;
  /** Default image for sandbox containers. */
  baseImage: string;
  /** Agent connections for running sandboxes. */
  agents: AgentManager;
  /** Repo root containing images/ (profile Dockerfiles). */
  imagesDir: string;
  /** Workspace root folder — every workspace must live inside it. */
  rootFolder: () => string;
}

/** Create a workspace FOLDER under the workspace root. */
export interface CreateWorkspaceInput {
  name: string;
  /** Optional explicit folder (must be inside the root); default: root/name. */
  hostRootPath?: string;
  /** Worktree workspaces record their branch (plan §14). */
  kind?: "main" | "worktree" | "directory";
  gitBranch?: string;
  /** Optional override for the auto-created sandbox mount (worktrees). */
  sandboxHostPath?: string;
  profile?: "node" | "python" | "universal";
  securityProfile?: "standard" | "restricted" | "trusted";
}

/** Create a SANDBOX container for a workspace. */
export interface CreateSandboxInput {
  /** Sandbox name; defaults to the workspace name. */
  name?: string;
  /** Optional explicit folder to mount (must be inside the root); default: the workspace folder. */
  hostPath?: string;
  securityProfile?: "standard" | "restricted" | "trusted";
  /** Environment profile (plan §11): maps to an image. */
  profile?: "node" | "python" | "universal";
  imageRef?: string;
  resources?: { cpuCores?: number; memoryGiB?: number; pidLimit?: number };
  /** Worktree sandboxes record their branch (plan §14). */
  kind?: "main" | "worktree" | "directory";
  gitBranch?: string;
}

const CONTAINER_WORKSPACE_PATH = "/workspace";

/** Port the workspace agent listens on INSIDE the container. */
export const AGENT_CONTAINER_PORT = 4175;

/**
 * Loopback-only dev-port range published for every sandbox: dev servers
 * started inside the sandbox on these ports are reachable at
 * http://127.0.0.1:<port> on the host (plan §16.2).
 */
export const DEV_PORT_RANGE = { hostStart: 43100, containerStart: 43100, count: 20 };

/** Environment profile → image reference (plan §11). */
export function imageForProfile(profile: "node" | "python" | "universal"): string {
  if (profile === "python") return "pi-control/python:local";
  if (profile === "universal") return "pi-control/universal:local";
  return "pi-control/base:local";
}

/** Allocate a free loopback port for the agent's host-side forward. */
export async function allocateAgentHostPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
}

const VOLUME_SUFFIXES = ["home", "state", "cache", "tools"] as const;

export class SandboxManager {
  private detection: RuntimeDetection | null = null;

  constructor(private readonly options: SandboxManagerOptions) {}

  get runtime(): SandboxRuntime {
    return this.options.runtime;
  }

  /* ------------------------------------------------------------------ */
  /* Sandbox runtime status/prepare/self-test                            */
  /* ------------------------------------------------------------------ */

  async refreshDetection(): Promise<RuntimeDetection> {
    const detection = await this.options.runtime.detect();
    this.detection = detection;
    this.publishStatus(detection);
    return detection;
  }

  statusPayload(detection: RuntimeDetection | null = this.detection): SandboxStatusPayload | null {
    if (!detection) return null;
    return {
      runtime: this.options.runtime.name,
      detected: detection.detected,
      rootlessAvailable: detection.rootlessAvailable,
      machineRequired: detection.machineRequired,
      machineConfigured: detection.machineConfigured,
      machineRunning: detection.machineRunning,
      version: detection.version,
      messages: detection.messages,
    };
  }

  async prepare(): Promise<{ ok: boolean; messages: string[] }> {
    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sandboxPrepare,
      payload: { phase: "started", message: "Preparing sandbox runtime" },
    });
    try {
      const result = await this.options.runtime.prepareHost();
      await this.refreshDetection();
      this.options.hub.publish({
        scope: "server",
        type: EVENT_TYPES.sandboxPrepare,
        payload: { phase: "complete", ok: result.ok, message: result.messages.join("\n") },
      });
      return { ok: result.ok, messages: result.messages };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.hub.publish({
        scope: "server",
        type: EVENT_TYPES.sandboxPrepare,
        payload: { phase: "error", message },
      });
      return { ok: false, messages: [message] };
    }
  }

  async selfTest(): Promise<SelfTestResult> {
    const { runSecuritySelfTest } = await import("@pi-control/sandbox/podman");
    const result = await runSecuritySelfTest({ runtime: this.options.runtime });
    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sandboxSelfTest,
      payload: { phase: "complete", ok: result.ok, checks: result.checks.map((c) => `${c.name}: ${c.ok ? "ok" : c.detail}`) },
    });
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Workspaces (folders under the workspace root)                       */
  /* ------------------------------------------------------------------ */

  /**
   * Create a workspace folder AND its primary sandbox (Invariant B: one
   * workspace owns exactly one container). Containment: the folder must
   * live inside the workspace root (when omitted, root/<name> is created).
   */
  async createWorkspace(input: CreateWorkspaceInput): Promise<{ workspace: WorkspaceInfo; sandbox: SandboxInfo }> {
    const root = this.options.rootFolder();
    let hostRootPath: string;
    if (input.hostRootPath) {
      hostRootPath = fs.realpathSync(input.hostRootPath);
      this.assertInsideRoot(hostRootPath, "Workspace folder");
    } else {
      hostRootPath = path.join(root, sanitizeName(input.name));
      fs.mkdirSync(hostRootPath, { recursive: true });
    }
    const stat = fs.statSync(hostRootPath, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      throw new Error(`Not a directory: ${input.hostRootPath ?? hostRootPath}`);
    }
    const now = nowIso();
    const record = {
      id: newId("ws"),
      machineId: "machine_local",
      name: input.name,
      hostRootPath,
      gitRepositoryRoot: null,
      createdAt: now,
      lastOpenedAt: now,
    };
    this.options.db.insert(schema.projects).values(record).run();
    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.workspaceCreated,
      payload: { workspace: toWorkspaceInfo(record) },
    });
    this.options.logger.info({ workspaceId: record.id, hostRootPath }, "workspace created");

    // Auto-create the primary sandbox (the container for this workspace),
    // named after the workspace, then START it — creation == running.
    const sandbox = await this.createSandbox(record.id, {
      name: input.name,
      hostPath: input.sandboxHostPath,
      kind: input.kind,
      gitBranch: input.gitBranch,
      profile: input.profile,
      securityProfile: input.securityProfile,
    });
    try {
      await this.startSandbox(sandbox.id);
    } catch (error) {
      this.options.logger.warn({ sandboxId: sandbox.id, error: String(error) }, "auto-start failed; sandbox left stopped");
    }
    const started = await this.sandboxInfo(sandbox.id);

    return { workspace: toWorkspaceInfo(record), sandbox: started };
  }

  /**
   * Scan the workspace root: every subfolder appears as a workspace (not
   * started). Only explicit creation starts the sandbox; a server restart
   * leaves everything stopped until the user presses start.
   */
  syncWorkspacesFromRoot(): number {
    const root = this.options.rootFolder();
    let created = 0;
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      return 0;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const folder = path.join(root, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(folder);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      const existing = this.options.db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.hostRootPath, folder))
        .get();
      if (existing) continue;
      const now = nowIso();
      this.options.db.insert(schema.projects).values({
        id: newId("ws"),
        machineId: "machine_local",
        name,
        hostRootPath: folder,
        gitRepositoryRoot: null,
        createdAt: now,
        lastOpenedAt: now,
      }).run();
      this.options.hub.publish({
        scope: "server",
        type: EVENT_TYPES.workspaceCreated,
        payload: { workspace: { id: newId("ws"), machineId: "machine_local", name, hostRootPath: folder, createdAt: now } },
      });
      created++;
    }
    if (created > 0) this.options.logger.info({ created }, "workspaces synced from root folder");
    return created;
  }

  /** Stop every sandbox container (server restart policy: all stopped). */
  async stopAllSandboxes(): Promise<void> {
    const rows = this.options.db.select().from(schema.workspaces).all().filter((r) => r.sandboxId);
    for (const row of rows) {
      try {
        await this.options.runtime.stopWorkspace(row.sandboxId as string);
      } catch {
        // container may already be gone
      }
      this.updateSandboxState(row.sandboxId as string, "stopped");
    }
    // Sessions whose sandbox stopped are marked stopped for explicit resume.
    if (rows.length > 0) {
      this.options.db
        .update(schema.sessions)
        .set({ status: "stopped", updatedAt: nowIso() })
        .run();
    }
    this.options.logger.info({ stopped: rows.length }, "all sandboxes stopped after server start");
  }

  listWorkspaces(): WorkspaceInfo[] {
    return this.options.db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).all().map(toWorkspaceInfo);
  }

  workspaceById(workspaceId: string): WorkspaceInfo | null {
    const row = this.options.db.select().from(schema.projects).where(eq(schema.projects.id, workspaceId)).get();
    return row ? toWorkspaceInfo(row) : null;
  }

  /* ------------------------------------------------------------------ */
  /* Sandboxes (containers)                                              */
  /* ------------------------------------------------------------------ */

  async createSandbox(workspaceId: string, input: CreateSandboxInput): Promise<SandboxInfo> {
    const workspace = this.options.db.select().from(schema.projects).where(eq(schema.projects.id, workspaceId)).get();
    if (!workspace) throw new Error(`Unknown workspace ${workspaceId}`);

    // Invariant B: one workspace owns exactly one primary sandbox.
    const existing = this.options.db.select().from(schema.workspaces).where(eq(schema.workspaces.projectId, workspaceId)).get();
    if (existing) {
      throw new Error(
        "Workspace already has a sandbox — one workspace owns one container (Invariant B). " +
          "For isolated work, create a new workspace (e.g. a Git worktree).",
      );
    }

    const hostPath = input.hostPath ? fs.realpathSync(input.hostPath) : workspace.hostRootPath;
    this.assertInsideRoot(hostPath, "Sandbox folder");
    const stat = fs.statSync(hostPath, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      throw new Error(`Not a directory: ${hostPath}`);
    }

    const sandboxId = newId("sbx");
    const containerName = `pi-control-${sandboxId}`;
    // Default environment: node + python. More can be installed later or via
    // the universal profile on rebuild — no picker needed at creation.
    const profile = input.profile ?? "python";
    const imageRef = input.imageRef ?? imageForProfile(profile);
    const capacity = await this.options.runtime.capacity();
    const defaults = defaultResources(capacity);

    // Make sure the profile image exists (podman build is layer-cached).
    await this.ensureProfileImage(profile);

    // Per-sandbox agent secret + loopback-forwarded agent port (ADR-0006).
    const agentToken = crypto.randomBytes(32).toString("hex");
    const agentHostPort = await allocateAgentHostPort();

    const spec: CreateWorkspaceSandboxSpec = {
      workspaceId: sandboxId,
      containerName,
      imageRef,
      workspaceMount: { hostPath, containerPath: CONTAINER_WORKSPACE_PATH },
      volumes: VOLUME_SUFFIXES.map((suffix) => ({
        name: `pi-control-${sandboxId}-${suffix}`,
        containerPath: suffix === "home" ? "/home/pi" : `/${suffix}`,
        kind: "volume",
      })),
      resources: {
        cpuCores: input.resources?.cpuCores ?? defaults.cpus,
        memoryGiB: input.resources?.memoryGiB ?? defaults.memoryBytes / 1024 ** 3,
        pidLimit: input.resources?.pidLimit ?? defaults.pidLimit,
      },
      securityProfile: input.securityProfile ?? "standard",
      ports: [{ hostPort: agentHostPort, containerPort: AGENT_CONTAINER_PORT }],
      portRanges: [DEV_PORT_RANGE],
      environment: {
        PI_CODING_AGENT_DIR: "/state/pi-agent",
        PI_CODING_AGENT_SESSION_DIR: "/state/pi-sessions",
        PI_CONTROL_AGENT_TOKEN: agentToken,
        PI_CONTROL_AGENT_PORT: String(AGENT_CONTAINER_PORT),
        PI_CONTROL_AGENT_HOST: "0.0.0.0",
        PI_CONTROL_WORKSPACE_ID: sandboxId,
      },
    };

    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sandboxState,
      payload: { sandboxId, status: "building" },
    });

    let sandbox: Awaited<ReturnType<SandboxRuntime["createWorkspace"]>>;
    try {
      sandbox = await this.options.runtime.createWorkspace(spec);
      this.options.runtime.registerSandbox(sandbox.id, containerName);
    } catch (error) {
      this.publishSandboxError(sandboxId, error);
      throw error;
    }

    const now = nowIso();
    this.options.db.insert(schema.workspaces).values({
      id: sandboxId,
      projectId: workspaceId,
      machineId: workspace.machineId,
      name: input.name ?? workspace.name,
      hostPath,
      containerWorkspacePath: CONTAINER_WORKSPACE_PATH,
      kind: input.kind ?? "main",
      gitBranch: input.gitBranch ?? null,
      securityProfile: spec.securityProfile,
      sandboxId: sandbox.id,
      createdAt: now,
    }).run();

    this.options.db.insert(schema.sandboxes).values({
      id: sandbox.id,
      workspaceId: sandboxId,
      runtime: sandbox.runtime,
      containerName,
      containerId: sandbox.containerId,
      imageRef,
      state: "stopped",
      securityProfile: spec.securityProfile,
      configJson: JSON.stringify(spec),
      createdAt: now,
      updatedAt: now,
    }).run();

    const info = await this.sandboxInfo(sandboxId, "stopped");
    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sandboxCreated,
      payload: { sandboxId, sandbox: info },
    });
    this.options.logger.info({ sandboxId, containerName, hostPath }, "sandbox created");
    return info;
  }

  async startSandbox(sandboxId: string): Promise<SandboxInfo> {
    const sandbox = this.requireSandbox(sandboxId);
    this.setSandboxState(sandboxId, "starting");
    try {
      await this.options.runtime.startWorkspace(sandbox.id);
      this.setSandboxState(sandboxId, "running");
      this.updateSandboxState(sandbox.id, "running");
      this.connectAgent(sandboxId, sandbox.id);
    } catch (error) {
      this.setSandboxState(sandboxId, "error");
      this.updateSandboxState(sandbox.id, "error");
      this.publishSandboxError(sandboxId, error);
      throw error;
    }
    return this.sandboxInfo(sandboxId, "running");
  }

  async stopSandbox(sandboxId: string): Promise<SandboxInfo> {
    const sandbox = this.requireSandbox(sandboxId);
    this.options.agents.disconnect(sandboxId);
    this.setSandboxState(sandboxId, "stopping");
    try {
      await this.options.runtime.stopWorkspace(sandbox.id);
      this.setSandboxState(sandboxId, "stopped");
      this.updateSandboxState(sandbox.id, "stopped");
    } catch (error) {
      this.publishSandboxError(sandboxId, error);
      throw error;
    }
    return this.sandboxInfo(sandboxId, "stopped");
  }

  async removeSandbox(sandboxId: string): Promise<void> {
    const sandbox = this.requireSandbox(sandboxId);
    try {
      await this.options.runtime.removeWorkspace(sandbox.id);
    } catch (error) {
      this.options.logger.warn({ sandboxId, error: String(error) }, "container removal failed; continuing");
    }
    // Keep the workspace row (archived); container is gone. Persistent
    // volumes survive for session recovery (plan §9.2).
    this.options.db
      .update(schema.workspaces)
      .set({ archivedAt: nowIso(), sandboxId: null })
      .where(eq(schema.workspaces.id, sandboxId))
      .run();
    this.options.db.update(schema.sandboxes).set({ state: "missing" }).where(eq(schema.sandboxes.id, sandbox.id)).run();
  }

  /**
   * Environment rebuild (plan §18.3): stop + remove the container, create a
   * new one from the (possibly new) profile image, preserve /workspace and
   * persistent volumes, reconnect the agent. Native Pi sessions persist in
   * /state and can be resumed.
   */
  async rebuildSandbox(sandboxId: string, profile?: "node" | "python" | "universal"): Promise<SandboxInfo> {
    const container = this.options.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, sandboxId)).get();
    if (!container) throw new Error(`Unknown sandbox ${sandboxId}`);
    const sandboxRow = this.options.db.select().from(schema.sandboxes).where(eq(schema.sandboxes.id, container.sandboxId ?? "")).get();
    if (!sandboxRow) throw new Error(`Sandbox ${sandboxId} has no runtime record`);

    const spec = JSON.parse(sandboxRow.configJson) as CreateWorkspaceSandboxSpec;
    if (profile) {
      spec.imageRef = imageForProfile(profile);
      await this.ensureProfileImage(profile);
    }

    this.options.agents.disconnect(sandboxId);
    this.setSandboxState(sandboxId, "building");
    try {
      await this.options.runtime.stopWorkspace(sandboxRow.id).catch(() => undefined);
      await this.options.runtime.removeWorkspace(sandboxRow.id);

      const rebuilt = await this.options.runtime.createWorkspace(spec);
      this.options.runtime.registerSandbox(rebuilt.id, spec.containerName);
      this.options.db
        .update(schema.sandboxes)
        .set({ imageRef: spec.imageRef, configJson: JSON.stringify(spec), containerId: rebuilt.containerId, state: "stopped", updatedAt: nowIso() })
        .where(eq(schema.sandboxes.id, sandboxRow.id))
        .run();

      await this.options.runtime.startWorkspace(rebuilt.id);
      this.updateSandboxState(rebuilt.id, "running");
      this.connectAgent(sandboxId, rebuilt.id);

      // Agent-side Pi sessions were lost with the old container; native
      // session files persist in /state — mark rows stopped for explicit resume.
      this.options.db
        .update(schema.sessions)
        .set({ status: "stopped", updatedAt: nowIso() })
        .where(eq(schema.sessions.workspaceId, sandboxId))
        .run();

      this.setSandboxState(sandboxId, "running");
      this.options.logger.info({ sandboxId, imageRef: spec.imageRef }, "sandbox rebuilt");
    } catch (error) {
      this.setSandboxState(sandboxId, "error");
      this.publishSandboxError(sandboxId, error);
      throw error;
    }
    return this.sandboxInfo(sandboxId, "running");
  }

  /** Return the workspace's sandbox, creating it when missing. */
  async ensureSandbox(workspaceId: string): Promise<SandboxInfo> {
    const workspace = this.options.db.select().from(schema.projects).where(eq(schema.projects.id, workspaceId)).get();
    if (!workspace) throw new Error(`Unknown workspace ${workspaceId}`);
    const existing = this.options.db.select().from(schema.workspaces).where(eq(schema.workspaces.projectId, workspaceId)).get();
    if (existing) return this.sandboxInfo(existing.id);
    return this.createSandbox(workspaceId, { name: workspace.name });
  }

  listSandboxes(workspaceId?: string): SandboxInfo[] {
    const rows = workspaceId
      ? this.options.db.select().from(schema.workspaces).where(eq(schema.workspaces.projectId, workspaceId)).all()
      : this.options.db.select().from(schema.workspaces).all();
    return rows.map((row) => this.toSandboxInfo(row));
  }

  async sandboxInfo(sandboxId: string, fallbackStatus?: SandboxStatus): Promise<SandboxInfo> {
    const row = this.options.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, sandboxId)).get();
    if (!row) throw new Error(`Unknown sandbox ${sandboxId}`);
    return this.toSandboxInfo(row, fallbackStatus);
  }

  /** Re-register persisted sandboxes after a server restart. */
  restoreSandboxes(): void {
    // Register every row — stopped sandboxes must be startable too.
    const rows = this.options.db.select().from(schema.sandboxes).all();
    for (const row of rows) {
      this.options.runtime.registerSandbox(row.id, row.containerName);
    }
  }

  /**
   * Agent endpoint for a sandbox, parsed from its runtime record
   * (the token and forwarded port are stored there at creation).
   */
  agentEndpoint(sandboxId: string): AgentEndpoint | null {
    const sandbox = this.options.db
      .select()
      .from(schema.sandboxes)
      .where(eq(schema.sandboxes.workspaceId, sandboxId))
      .get();
    if (!sandbox) return null;
    try {
      const config = JSON.parse(sandbox.configJson) as {
        ports?: Array<{ hostPort: number }>;
        environment?: Record<string, string>;
      };
      const hostPort = config.ports?.[0]?.hostPort;
      const token = config.environment?.PI_CONTROL_AGENT_TOKEN;
      if (!hostPort || !token) return null;
      return { url: `ws://127.0.0.1:${hostPort}`, token };
    } catch {
      return null;
    }
  }

  /** Reconnect agents for running sandboxes after a server restart. */
  restoreAgents(): void {
    const rows = this.options.db.select().from(schema.sandboxes).where(eq(schema.sandboxes.state, "running")).all();
    for (const row of rows) {
      this.connectAgent(row.workspaceId, row.id);
    }
  }

  sandboxCount(): number {
    return this.options.db.select().from(schema.workspaces).all().length;
  }

  workspaceCount(): number {
    return this.options.db.select().from(schema.projects).all().length;
  }

  /* ------------------------------------------------------------------ */

  /** Build the profile image when the runtime is podman and it is missing. */
  private async ensureProfileImage(profile: "node" | "python" | "universal"): Promise<void> {
    if (this.options.runtime.name !== "podman") return;
    const imageRef = imageForProfile(profile);
    try {
      await this.options.runtime.pullImage(imageRef);
      return;
    } catch {
      // local-only name — build from the repository Dockerfiles
    }
    const buildDir =
      profile === "node"
        ? path.join(this.options.imagesDir, "images", "base")
        : path.join(this.options.imagesDir, "images", "profiles", profile);
    await this.options.runtime.buildImage({
      imageRef,
      buildDir,
      labels: { "pi-control.profile": profile },
    });
    this.options.logger.info({ profile, imageRef }, "profile image built");
  }

  private assertInsideRoot(realPath: string, what: string): void {
    const root = fs.realpathSync(this.options.rootFolder());
    if (realPath !== root && !realPath.startsWith(root + path.sep)) {
      throw new Error(`${what} must be inside the workspace root: ${root}`);
    }
  }

  private requireSandbox(sandboxId: string): { id: string; containerName: string } {
    const row = this.options.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, sandboxId)).get();
    if (!row) throw new Error(`Unknown sandbox ${sandboxId}`);
    if (!row.sandboxId) throw new Error(`Sandbox ${sandboxId} has no runtime container`);
    return { id: row.sandboxId, containerName: `pi-control-${sandboxId}` };
  }

  private setSandboxState(sandboxId: string, status: SandboxStatus): void {
    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sandboxState,
      payload: { sandboxId, status },
    });
  }

  private updateSandboxState(runtimeSandboxId: string, state: string): void {
    this.options.db
      .update(schema.sandboxes)
      .set({ state, updatedAt: nowIso() })
      .where(eq(schema.sandboxes.id, runtimeSandboxId))
      .run();
  }

  private publishSandboxError(sandboxId: string, error: unknown): void {
    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sandboxError,
      payload: { sandboxId, message: error instanceof Error ? error.message : String(error) },
    });
  }

  private publishStatus(detection: RuntimeDetection): void {
    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sandboxStatus,
      payload: this.statusPayload(detection),
    });
  }

  private connectAgent(sandboxId: string, _runtimeSandboxId: string): void {
    const endpoint = this.agentEndpoint(sandboxId);
    if (!endpoint) {
      this.options.logger.warn({ sandboxId }, "sandbox has no agent endpoint; skipping agent connection");
      return;
    }
    this.options.agents.connect(sandboxId, endpoint);
  }

  private toSandboxInfo(
    row: {
      id: string;
      projectId: string;
      machineId: string;
      name: string;
      hostPath: string;
      containerWorkspacePath: string;
      kind: string;
      gitBranch: string | null;
      securityProfile: string;
      sandboxId: string | null;
      createdAt: string;
      archivedAt: string | null;
    },
    fallbackStatus?: SandboxStatus,
  ): SandboxInfo {
    // The runtime record (schema.sandboxes) is the status source of truth;
    // without it the row alone cannot tell running from stopped.
    const runtimeRow = row.sandboxId
      ? this.options.db.select().from(schema.sandboxes).where(eq(schema.sandboxes.id, row.sandboxId)).get()
      : null;
    const status: SandboxStatus =
      fallbackStatus ??
      (runtimeRow?.state as SandboxStatus | undefined) ??
      (row.archivedAt ? "missing" : row.sandboxId ? "stopped" : "missing");
    return {
      id: row.id,
      workspaceId: row.projectId,
      machineId: row.machineId,
      name: row.name,
      hostPath: row.hostPath,
      containerWorkspacePath: row.containerWorkspacePath,
      kind: row.kind as SandboxInfo["kind"],
      gitBranch: row.gitBranch ?? undefined,
      securityProfile: row.securityProfile as SandboxInfo["securityProfile"],
      status,
      createdAt: row.createdAt,
      archivedAt: row.archivedAt ?? undefined,
    };
  }
}

function sanitizeName(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  if (!cleaned) throw new Error("Invalid name");
  return cleaned;
}

function toWorkspaceInfo(row: {
  id: string;
  machineId: string;
  name: string;
  hostRootPath: string;
  gitRepositoryRoot: string | null;
  createdAt: string;
  lastOpenedAt: string | null;
}): WorkspaceInfo {
  return {
    id: row.id,
    machineId: row.machineId,
    name: row.name,
    hostRootPath: row.hostRootPath,
    gitRepositoryRoot: row.gitRepositoryRoot ?? undefined,
    createdAt: row.createdAt,
    lastOpenedAt: row.lastOpenedAt ?? undefined,
  };
}
