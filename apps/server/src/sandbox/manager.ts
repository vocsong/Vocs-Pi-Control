/**
 * SandboxManager — control-plane ownership of projects, workspaces and
 * sandbox containers (plan §4, §18, §21).
 *
 * The control server owns sandbox lifecycle; Pi agents never receive
 * Podman control (Invariant E). All container operations go through the
 * SandboxRuntime adapter.
 */

import fs from "node:fs";
import net from "node:net";
import crypto from "node:crypto";
import { schema, type Db } from "@pi-control/database";
import { desc, eq } from "drizzle-orm";
import {
  EVENT_TYPES,
  type ProjectInfo,
  type SandboxStatusPayload,
  type WorkspaceInfo,
  type WorkspaceStatus,
} from "@pi-control/protocol";
import {
  defaultResources,
  type CreateWorkspaceSandboxSpec,
  type RuntimeDetection,
  type SandboxInfo,
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
  /** Default image for workspace containers. */
  baseImage: string;
  /** Agent connections for running workspaces. */
  agents: AgentManager;
}

export interface CreateProjectInput {
  name: string;
  hostRootPath: string;
}

export interface CreateWorkspaceInput {
  name: string;
  hostPath: string;
  securityProfile?: "standard" | "restricted" | "trusted";
  imageRef?: string;
  resources?: { cpuCores?: number; memoryGiB?: number; pidLimit?: number };
}

const CONTAINER_WORKSPACE_PATH = "/workspace";

/** Port the workspace agent listens on INSIDE the container. */
export const AGENT_CONTAINER_PORT = 4175;

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
  /* Projects                                                            */
  /* ------------------------------------------------------------------ */

  createProject(input: CreateProjectInput): ProjectInfo {
    const hostRootPath = fs.realpathSync(input.hostRootPath);
    const stat = fs.statSync(hostRootPath, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      throw new Error(`Not a directory: ${input.hostRootPath}`);
    }
    const now = nowIso();
    const record = {
      id: newId("proj"),
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
      type: EVENT_TYPES.projectCreated,
      payload: { project: toProjectInfo(record) },
    });
    return toProjectInfo(record);
  }

  listProjects(): ProjectInfo[] {
    return this.options.db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).all().map(toProjectInfo);
  }

  /* ------------------------------------------------------------------ */
  /* Workspaces                                                          */
  /* ------------------------------------------------------------------ */

  async createWorkspace(projectId: string, input: CreateWorkspaceInput): Promise<WorkspaceInfo> {
    const project = this.options.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (!project) throw new Error(`Unknown project ${projectId}`);

    const hostPath = fs.realpathSync(input.hostPath);
    const stat = fs.statSync(hostPath, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      throw new Error(`Not a directory: ${input.hostPath}`);
    }

    const workspaceId = newId("ws");
    const containerName = `pi-control-${workspaceId}`;
    const imageRef = input.imageRef ?? this.options.baseImage;
    const capacity = await this.options.runtime.capacity();
    const defaults = defaultResources(capacity);

    // Per-sandbox agent secret + loopback-forwarded agent port (ADR-0006).
    const agentToken = crypto.randomBytes(32).toString("hex");
    const agentHostPort = await allocateAgentHostPort();

    const spec: CreateWorkspaceSandboxSpec = {
      workspaceId,
      containerName,
      imageRef,
      workspaceMount: { hostPath, containerPath: CONTAINER_WORKSPACE_PATH },
      volumes: VOLUME_SUFFIXES.map((suffix) => ({
        name: `pi-control-${workspaceId}-${suffix}`,
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
      environment: {
        PI_CODING_AGENT_DIR: "/state/pi-agent",
        PI_CODING_AGENT_SESSION_DIR: "/state/pi-sessions",
        PI_CONTROL_AGENT_TOKEN: agentToken,
        PI_CONTROL_AGENT_PORT: String(AGENT_CONTAINER_PORT),
        PI_CONTROL_AGENT_HOST: "0.0.0.0",
        PI_CONTROL_WORKSPACE_ID: workspaceId,
      },
    };

    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.workspaceState,
      payload: { workspaceId, status: "building" },
    });

    let sandbox: SandboxInfo;
    try {
      sandbox = await this.options.runtime.createWorkspace(spec);
      this.options.runtime.registerSandbox(sandbox.id, containerName);
    } catch (error) {
      this.publishWorkspaceError(workspaceId, error);
      throw error;
    }

    const now = nowIso();
    this.options.db.insert(schema.workspaces).values({
      id: workspaceId,
      projectId,
      machineId: project.machineId,
      name: input.name,
      hostPath,
      containerWorkspacePath: CONTAINER_WORKSPACE_PATH,
      kind: "main",
      securityProfile: spec.securityProfile,
      sandboxId: sandbox.id,
      createdAt: now,
    }).run();

    this.options.db.insert(schema.sandboxes).values({
      id: sandbox.id,
      workspaceId,
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

    const info = await this.workspaceInfo(workspaceId, "stopped");
    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.workspaceCreated,
      payload: { workspaceId, workspace: info },
    });
    this.options.logger.info({ workspaceId, containerName, hostPath }, "workspace created");
    return info;
  }

  async startWorkspace(workspaceId: string): Promise<WorkspaceInfo> {
    const sandbox = this.requireSandbox(workspaceId);
    this.setWorkspaceState(workspaceId, "starting");
    try {
      await this.options.runtime.startWorkspace(sandbox.id);
      this.setWorkspaceState(workspaceId, "running");
      this.updateSandboxState(sandbox.id, "running");
      this.connectAgent(workspaceId, sandbox.id);
    } catch (error) {
      this.setWorkspaceState(workspaceId, "error");
      this.updateSandboxState(sandbox.id, "error");
      this.publishWorkspaceError(workspaceId, error);
      throw error;
    }
    return this.workspaceInfo(workspaceId, "running");
  }

  async stopWorkspace(workspaceId: string): Promise<WorkspaceInfo> {
    const sandbox = this.requireSandbox(workspaceId);
    this.options.agents.disconnect(workspaceId);
    this.setWorkspaceState(workspaceId, "stopping");
    try {
      await this.options.runtime.stopWorkspace(sandbox.id);
      this.setWorkspaceState(workspaceId, "stopped");
      this.updateSandboxState(sandbox.id, "stopped");
    } catch (error) {
      this.publishWorkspaceError(workspaceId, error);
      throw error;
    }
    return this.workspaceInfo(workspaceId, "stopped");
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    const sandbox = this.requireSandbox(workspaceId);
    try {
      await this.options.runtime.removeWorkspace(sandbox.id);
    } catch (error) {
      this.options.logger.warn({ workspaceId, error: String(error) }, "container removal failed; continuing");
    }
    // Keep workspace row (archived); container is gone. Persistent volumes
    // survive for session recovery (plan §9.2).
    this.options.db
      .update(schema.workspaces)
      .set({ archivedAt: nowIso(), sandboxId: null })
      .where(eq(schema.workspaces.id, workspaceId))
      .run();
    this.options.db.update(schema.sandboxes).set({ state: "missing" }).where(eq(schema.sandboxes.id, sandbox.id)).run();
  }

  listWorkspaces(projectId?: string): WorkspaceInfo[] {
    const rows = projectId
      ? this.options.db.select().from(schema.workspaces).where(eq(schema.workspaces.projectId, projectId)).all()
      : this.options.db.select().from(schema.workspaces).all();
    return rows.map((row) => this.toWorkspaceInfo(row));
  }

  async workspaceInfo(workspaceId: string, fallbackStatus?: WorkspaceStatus): Promise<WorkspaceInfo> {
    const row = this.options.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).get();
    if (!row) throw new Error(`Unknown workspace ${workspaceId}`);
    return this.toWorkspaceInfo(row, fallbackStatus);
  }

  /** Re-register persisted sandboxes after a server restart. */
  restoreSandboxes(): void {
    const rows = this.options.db.select().from(schema.sandboxes).where(eq(schema.sandboxes.state, "running")).all();
    for (const row of rows) {
      this.options.runtime.registerSandbox(row.id, row.containerName);
    }
  }

  /**
   * Agent endpoint for a workspace, parsed from its sandbox record
   * (the token and forwarded port are stored there at creation).
   */
  agentEndpoint(workspaceId: string): AgentEndpoint | null {
    const sandbox = this.options.db
      .select()
      .from(schema.sandboxes)
      .where(eq(schema.sandboxes.workspaceId, workspaceId))
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

  /** Reconnect agents for running workspaces after a server restart. */
  restoreAgents(): void {
    const rows = this.options.db.select().from(schema.sandboxes).where(eq(schema.sandboxes.state, "running")).all();
    for (const row of rows) {
      this.connectAgent(row.workspaceId, row.id);
    }
  }

  workspaceCount(): number {
    return this.options.db.select().from(schema.workspaces).all().length;
  }

  projectCount(): number {
    return this.options.db.select().from(schema.projects).all().length;
  }

  /* ------------------------------------------------------------------ */

  private requireSandbox(workspaceId: string): { id: string; containerName: string } {
    const workspace = this.options.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).get();
    if (!workspace) throw new Error(`Unknown workspace ${workspaceId}`);
    if (!workspace.sandboxId) throw new Error(`Workspace ${workspaceId} has no sandbox`);
    return { id: workspace.sandboxId, containerName: `pi-control-${workspaceId}` };
  }

  private setWorkspaceState(workspaceId: string, status: WorkspaceStatus): void {
    this.options.hub.publish({
      scope: "workspace",
      workspaceId,
      type: EVENT_TYPES.workspaceState,
      payload: { workspaceId, status },
    });
  }

  private updateSandboxState(sandboxId: string, state: string): void {
    this.options.db
      .update(schema.sandboxes)
      .set({ state, updatedAt: nowIso() })
      .where(eq(schema.sandboxes.id, sandboxId))
      .run();
  }

  private publishWorkspaceError(workspaceId: string, error: unknown): void {
    this.options.hub.publish({
      scope: "workspace",
      workspaceId,
      type: EVENT_TYPES.workspaceError,
      payload: { workspaceId, message: error instanceof Error ? error.message : String(error) },
    });
  }

  private publishStatus(detection: RuntimeDetection): void {
    this.options.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sandboxStatus,
      payload: this.statusPayload(detection),
    });
  }

  private connectAgent(workspaceId: string, _sandboxId: string): void {
    const endpoint = this.agentEndpoint(workspaceId);
    if (!endpoint) {
      this.options.logger.warn({ workspaceId }, "workspace has no agent endpoint; skipping agent connection");
      return;
    }
    this.options.agents.connect(workspaceId, endpoint);
  }

  private toWorkspaceInfo(
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
    fallbackStatus?: WorkspaceStatus,
  ): WorkspaceInfo {
    return {
      id: row.id,
      projectId: row.projectId,
      machineId: row.machineId,
      name: row.name,
      hostPath: row.hostPath,
      containerWorkspacePath: row.containerWorkspacePath,
      kind: row.kind as WorkspaceInfo["kind"],
      gitBranch: row.gitBranch ?? undefined,
      securityProfile: row.securityProfile as WorkspaceInfo["securityProfile"],
      sandboxId: row.sandboxId ?? undefined,
      status: fallbackStatus ?? (row.archivedAt ? "missing" : "stopped"),
      createdAt: row.createdAt,
      archivedAt: row.archivedAt ?? undefined,
    };
  }
}

function toProjectInfo(row: {
  id: string;
  machineId: string;
  name: string;
  hostRootPath: string;
  gitRepositoryRoot: string | null;
  createdAt: string;
  lastOpenedAt: string | null;
}): ProjectInfo {
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
