/**
 * MockSandboxRuntime — in-memory fake of the SandboxRuntime interface.
 *
 * Used for unit/UI tests and for Phase 0 demo mode where no Podman is
 * required. Real rootless Podman is exercised only in dedicated integration
 * suites (plan §48.2).
 */

import {
  type BuildImageSpec,
  type CreateWorkspaceSandboxSpec,
  type ImageInfo,
  type LogEvent,
  type LogOptions,
  type PortInfo,
  type PrepareResult,
  type RuntimeDetection,
  type SandboxExecHandle,
  type SandboxExecRequest,
  type SandboxInfo,
  type SandboxRuntime,
  type SandboxState,
} from "./index.js";
import { newId, nowIso, sleep } from "@pi-control/shared";
import os from "node:os";

export interface MockSandboxRuntimeOptions {
  /** Simulated detection result. */
  detection?: Partial<RuntimeDetection>;
  /** Simulated prepare failure. */
  failPrepare?: boolean;
  /** Delay for state transitions in ms. */
  speedMs?: number;
}

const DEFAULT_DETECTION: RuntimeDetection = {
  runtime: "mock",
  detected: true,
  rootlessAvailable: true,
  machineRequired: false,
  machineConfigured: true,
  machineRunning: true,
  version: "mock-0.0.0",
  messages: ["Using mock sandbox runtime (no container isolation in demo mode)."],
};

export class MockSandboxRuntime implements SandboxRuntime {
  readonly name = "mock" as const;

  private readonly sandboxes = new Map<string, SandboxInfo>();
  private readonly names = new Map<string, string>();
  private readonly detection: RuntimeDetection;
  private readonly failPrepare: boolean;
  private readonly speedMs: number;

  constructor(options: MockSandboxRuntimeOptions = {}) {
    this.detection = { ...DEFAULT_DETECTION, ...options.detection };
    this.failPrepare = options.failPrepare ?? false;
    this.speedMs = options.speedMs ?? 10;
  }

  async detect(): Promise<RuntimeDetection> {
    return { ...this.detection };
  }

  async prepareHost(): Promise<PrepareResult> {
    if (this.failPrepare) {
      return { ok: false, machineStarted: false, rootlessVerified: false, messages: ["Simulated prepare failure"] };
    }
    return {
      ok: true,
      machineName: "mock",
      machineStarted: true,
      rootlessVerified: true,
      messages: ["Mock runtime prepared."],
    };
  }

  registerSandbox(sandboxId: string, containerName: string): void {
    this.names.set(sandboxId, containerName);
    // Mirror the podman runtime: a registered sandbox may already exist
    // (e.g. restored after a server restart).
    if (!this.sandboxes.has(sandboxId)) {
      const now = nowIso();
      this.sandboxes.set(sandboxId, {
        id: sandboxId,
        workspaceId: sandboxId,
        runtime: "mock",
        containerName,
        imageRef: "mock",
        state: "running",
        securityProfile: "standard",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async createWorkspace(spec: CreateWorkspaceSandboxSpec): Promise<SandboxInfo> {
    await sleep(this.speedMs);
    const info: SandboxInfo = {
      id: newId("sbx"),
      workspaceId: spec.workspaceId,
      runtime: "mock",
      containerName: spec.containerName,
      imageRef: spec.imageRef,
      state: "stopped",
      securityProfile: spec.securityProfile,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.sandboxes.set(info.id, info);
    return { ...info };
  }

  async startWorkspace(sandboxId: string): Promise<void> {
    const info = this.require(sandboxId);
    info.state = "starting";
    await sleep(this.speedMs);
    info.state = "running";
    info.containerId = `mock-${info.id}`;
    info.updatedAt = nowIso();
  }

  async stopWorkspace(sandboxId: string): Promise<void> {
    const info = this.require(sandboxId);
    info.state = "stopping";
    await sleep(this.speedMs);
    info.state = "stopped";
    info.updatedAt = nowIso();
  }

  async removeWorkspace(sandboxId: string): Promise<void> {
    const info = this.require(sandboxId);
    info.state = "missing";
    this.sandboxes.delete(sandboxId);
  }

  async inspect(sandboxId: string): Promise<SandboxInfo> {
    return { ...this.require(sandboxId) };
  }

  async capacity(): Promise<{ cpus: number; memTotalBytes: number }> {
    return {
      cpus: os.availableParallelism?.() ?? 4,
      memTotalBytes: os.totalmem(),
    };
  }

  async exec(sandboxId: string, request: SandboxExecRequest): Promise<SandboxExecHandle> {
    this.require(sandboxId);
    const cmd = request.command.join(" ");

    // Emulate the observable contract of a compliant sandbox so the security
    // self-test (and tests depending on it) can run without Podman:
    //   - /workspace writes succeed and are readable back
    //   - host-home and socket probes report "absent"
    //   - /proc/mounts shows no host paths
    if (cmd.includes("echo pi-control-selftest")) {
      return { exitCode: 0, stdout: "pi-control-selftest\n", stderr: "", truncated: false };
    }
    if (cmd.includes("echo absent")) {
      return { exitCode: 0, stdout: "absent\n", stderr: "", truncated: false };
    }
    if (cmd.includes("cat /proc/mounts")) {
      return { exitCode: 0, stdout: "", stderr: "", truncated: false };
    }
    if (cmd.includes("id -u")) {
      return { exitCode: 0, stdout: "1000\n", stderr: "", truncated: false };
    }
    if (cmd.includes("grep CapEff")) {
      return { exitCode: 0, stdout: "0000000000000000\n", stderr: "", truncated: false };
    }

    return {
      exitCode: 0,
      stdout: `[mock] executed: ${cmd} (cwd: ${request.cwd ?? "/workspace"})`,
      stderr: "",
      truncated: false,
    };
  }

  async *logs(sandboxId: string, _options?: LogOptions): AsyncIterable<LogEvent> {
    this.require(sandboxId);
    yield { timestamp: nowIso(), stream: "stdout", text: "[mock] sandbox logs (none)" };
  }

  async buildImage(spec: BuildImageSpec): Promise<ImageInfo> {
    await sleep(this.speedMs);
    return { ref: spec.imageRef, id: `mock-image-${spec.imageRef}` };
  }

  async pullImage(ref: string): Promise<ImageInfo> {
    await sleep(this.speedMs);
    return { ref, id: `mock-image-${ref}` };
  }

  async listPorts(sandboxId: string): Promise<PortInfo[]> {
    this.require(sandboxId);
    return [];
  }

  private require(sandboxId: string): SandboxInfo {
    const info = this.sandboxes.get(sandboxId);
    if (!info) throw new Error(`MockSandboxRuntime: unknown sandbox ${sandboxId}`);
    return info;
  }

  /** Test helper: list known sandbox states. */
  stateOf(sandboxId: string): SandboxState | undefined {
    return this.sandboxes.get(sandboxId)?.state;
  }
}
