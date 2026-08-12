/**
 * RootlessPodmanRuntime — V1 sandbox runtime (plan §6, ADR-0002).
 *
 * Rootless Podman is the primary isolation boundary. All container
 * operations go through this adapter; the security-critical flag set is
 * built by buildCreateArgs (unit-tested) and path translation lives in
 * paths.ts.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newId, nowIso } from "@pi-control/shared";
import type {
  BuildImageSpec,
  CreateWorkspaceSandboxSpec,
  ImageInfo,
  LogEvent,
  LogOptions,
  PortInfo,
  PrepareResult,
  RuntimeDetection,
  SandboxExecHandle,
  SandboxExecRequest,
  SandboxInfo,
  SandboxRuntime,
  VolumeSpec,
} from "../index.js";
import { buildCreateArgs } from "./buildArgs.js";
import { translateHostPath } from "./paths.js";
import { defaultResources, type HostCapacity } from "./resources.js";
import { createPodmanRunner, PodmanError, type PodmanRunner } from "./runner.js";

export const DEFAULT_MACHINE_NAME = "pi-control";

export interface RootlessPodmanOptions {
  runner?: PodmanRunner;
  platform?: NodeJS.Platform;
  machineName?: string;
  /** Timeout for machine create/start (first run downloads a VM image). */
  machineTimeoutMs?: number;
}

interface PodmanInfo {
  host?: {
    security?: { rootless?: boolean };
    cpus?: number;
    memTotal?: number;
    ociRuntime?: { name?: string };
  };
}

interface MachineRow {
  Name?: string;
  Running?: boolean;
  VMType?: string;
  Provider?: string;
}

export class RootlessPodmanRuntime implements SandboxRuntime {
  readonly name = "podman" as const;

  private readonly runner: PodmanRunner;
  private readonly platform: NodeJS.Platform;
  private readonly machineName: string;
  private readonly machineTimeoutMs: number;
  private readonly containerNames = new Map<string, string>();
  private readonly workspaceIds = new Map<string, string>();

  constructor(options: RootlessPodmanOptions = {}) {
    this.runner = options.runner ?? createPodmanRunner();
    this.platform = options.platform ?? process.platform;
    this.machineName = options.machineName ?? DEFAULT_MACHINE_NAME;
    this.machineTimeoutMs = options.machineTimeoutMs ?? 15 * 60_000;
  }

  get machineRequired(): boolean {
    return this.platform === "win32" || this.platform === "darwin";
  }

  /* ------------------------------------------------------------------ */
  /* Detection / preparation                                             */
  /* ------------------------------------------------------------------ */

  async detect(): Promise<RuntimeDetection> {
    const messages: string[] = [];
    let version: string | undefined;

    try {
      const result = await this.runner.podman(["--version"], { timeoutMs: 10_000 });
      version = result.stdout.trim();
    } catch (error) {
      if (error instanceof PodmanError && error.exitCode === undefined) {
        return {
          runtime: "podman",
          detected: false,
          rootlessAvailable: false,
          machineRequired: this.machineRequired,
          machineConfigured: false,
          machineRunning: false,
          messages: [error.message],
        };
      }
      throw error;
    }

    let machines: MachineRow[] = [];
    if (this.machineRequired) {
      machines = await this.listMachines();
      const hasMachine = machines.length > 0;
      const running = machines.some((m) => m.Running);
      messages.push(
        hasMachine
          ? `Podman machine found: ${machines.map((m) => m.Name).join(", ")}${running ? " (running)" : " (stopped)"}`
          : `No Podman machine configured. Preparation will create a dedicated "${this.machineName}" machine.`,
      );
      if (!hasMachine) {
        return {
          runtime: "podman",
          detected: true,
          rootlessAvailable: false,
          machineRequired: true,
          machineConfigured: false,
          machineRunning: false,
          version,
          messages,
        };
      }
      if (!running) {
        return {
          runtime: "podman",
          detected: true,
          rootlessAvailable: false,
          machineRequired: true,
          machineConfigured: true,
          machineRunning: false,
          version,
          messages,
        };
      }
    }

    // Machine running (or no machine needed): check rootless capability.
    try {
      const info = await this.info();
      const rootless = info.host?.security?.rootless === true;
      messages.push(
        rootless
          ? "Rootless runtime verified."
          : "Podman is running rootful — rootless is required. Recreate the machine with --rootful=false.",
      );
      return {
        runtime: "podman",
        detected: true,
        rootlessAvailable: rootless,
        machineRequired: this.machineRequired,
        machineConfigured: !this.machineRequired || machines.length > 0,
        machineRunning: !this.machineRequired || machines.some((m) => m.Running),
        version,
        messages,
      };
    } catch (error) {
      messages.push(`Machine not reachable yet: ${error instanceof Error ? error.message : String(error)}`);
      return {
        runtime: "podman",
        detected: true,
        rootlessAvailable: false,
        machineRequired: this.machineRequired,
        machineConfigured: machines.length > 0,
        machineRunning: machines.some((m) => m.Running),
        version,
        messages,
      };
    }
  }

  async prepareHost(): Promise<PrepareResult> {
    const messages: string[] = [];
    const detection = await this.detect();
    if (!detection.detected) {
      return { ok: false, machineStarted: false, rootlessVerified: false, messages: detection.messages };
    }

    let machineStarted = false;
    if (this.machineRequired) {
      const machines = await this.listMachines();
      const existing = machines.find((m) => m.Name === this.machineName);
      if (!existing) {
        messages.push(`Creating dedicated Podman machine "${this.machineName}" (first run downloads a VM image)...`);
        await this.initMachine();
        messages.push(`Machine "${this.machineName}" created.`);
      }
      const running = machines.some((m) => m.Name === this.machineName && m.Running);
      if (!running) {
        messages.push(`Starting machine "${this.machineName}"...`);
        await this.runner.podman(["machine", "start", this.machineName], {
          timeoutMs: this.machineTimeoutMs,
          maxOutputBytes: 64 * 1024,
        });
        machineStarted = true;
        messages.push(`Machine "${this.machineName}" started.`);
      } else {
        messages.push(`Machine "${this.machineName}" already running.`);
      }
    }

    // Verify the rootless runtime is reachable.
    const info = await this.info();
    const rootless = info.host?.security?.rootless === true;
    if (!rootless) {
      return {
        ok: false,
        machineStarted,
        rootlessVerified: false,
        messages: [...messages, "Podman is not running rootless. Refusing to continue (plan §7.1: no rootful fallback)."],
      };
    }
    messages.push("Rootless runtime verified.");

    return { ok: true, machineName: this.machineName, machineStarted, rootlessVerified: true, messages };
  }

  async capacity(): Promise<HostCapacity> {
    try {
      const info = await this.info();
      if (info.host?.cpus && info.host.memTotal) {
        return { cpus: info.host.cpus, memTotalBytes: info.host.memTotal };
      }
    } catch {
      // fall through to local detection
    }
    return {
      cpus: os.availableParallelism?.() ?? os.cpus().length,
      memTotalBytes: os.totalmem(),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Workspace lifecycle                                                 */
  /* ------------------------------------------------------------------ */

  registerSandbox(sandboxId: string, containerName: string): void {
    this.containerNames.set(sandboxId, containerName);
  }

  async createWorkspace(spec: CreateWorkspaceSandboxSpec): Promise<SandboxInfo> {
    const workspaceMount = translateHostPath(spec.workspaceMount.hostPath);

    // Named volumes for private persistent state.
    for (const volume of spec.volumes) {
      if (volume.kind === "volume") {
        await this.ensureVolume(volume, spec.workspaceId);
      }
    }

    const args = buildCreateArgs({
      containerName: spec.containerName,
      imageRef: spec.imageRef,
      workspaceMount: { ...spec.workspaceMount, hostPath: workspaceMount.machinePath },
      volumes: spec.volumes,
      tmpfsPaths: ["/tmp", "/run"],
      resources: {
        cpus: spec.resources.cpuCores,
        memoryBytes: spec.resources.memoryGiB * 1024 ** 3,
        pidLimit: spec.resources.pidLimit,
      },
      securityProfile: spec.securityProfile,
      ports: spec.ports,
      portRanges: spec.portRanges,
      environment: spec.environment,
    });

    const result = await this.runner.podman(args, { timeoutMs: 300_000 });
    const containerId = result.stdout.trim();

    const now = nowIso();
    const info: SandboxInfo = {
      id: newId("sbx"),
      workspaceId: spec.workspaceId,
      runtime: "podman",
      containerName: spec.containerName,
      containerId,
      imageRef: spec.imageRef,
      state: "stopped",
      securityProfile: spec.securityProfile,
      createdAt: now,
      updatedAt: now,
    };
    this.containerNames.set(info.id, spec.containerName);
    this.workspaceIds.set(info.id, spec.workspaceId);
    return info;
  }

  async startWorkspace(sandboxId: string): Promise<void> {
    const name = await this.containerNameOf(sandboxId);
    await this.runner.podman(["start", name], { timeoutMs: 120_000 });
    // Wait until the container reports running.
    const deadline = Date.now() + 60_000;
    for (;;) {
      const state = await this.stateOf(name);
      if (state === "running") return;
      if (Date.now() > deadline) {
        throw new PodmanError(`Container ${name} did not reach running state`, ["start", name]);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async stopWorkspace(sandboxId: string): Promise<void> {
    const name = await this.containerNameOf(sandboxId);
    await this.runner.podman(["stop", "--time", "10", name], { timeoutMs: 60_000, reject: false });
  }

  async removeWorkspace(sandboxId: string): Promise<void> {
    const name = await this.containerNameOf(sandboxId);
    await this.runner.podman(["rm", "--force", name], { timeoutMs: 60_000, reject: false });
    // NOTE: named volumes (/home/pi, /state, /cache, /tools) are retained —
    // container teardown must never destroy native Pi session state (plan §9.2).
  }

  async inspect(sandboxId: string): Promise<SandboxInfo> {
    const name = await this.containerNameOf(sandboxId);
    const result = await this.runner.podman(["inspect", "--format", "{{json .}}", name]);
    const parsed = JSON.parse(result.stdout) as {
      Id?: string;
      Image?: string;
      State?: { Status?: string };
      HostConfig?: { PortBindings?: Record<string, unknown> };
    };
    const state = parsed.State?.Status ?? "unknown";
    return {
      id: sandboxId,
      workspaceId: this.workspaceIds.get(sandboxId) ?? sandboxId,
      runtime: "podman",
      containerName: name,
      containerId: parsed.Id,
      imageRef: parsed.Image ?? "",
      state: mapPodmanState(state),
      securityProfile: "standard",
      createdAt: "",
      updatedAt: nowIso(),
    };
  }

  async exec(sandboxId: string, request: SandboxExecRequest): Promise<SandboxExecHandle> {
    const name = await this.containerNameOf(sandboxId);
    const args = ["exec"];
    if (request.cwd) args.push("--workdir", request.cwd);
    for (const [key, value] of Object.entries(request.environment ?? {})) {
      args.push("--env", `${key}=${value}`);
    }
    args.push(name, ...request.command);

    try {
      const result = await this.runner.podman(args, {
        timeoutMs: request.timeoutMs ?? 120_000,
        maxOutputBytes: request.maxOutputBytes ?? 256 * 1024,
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
      };
    } catch (error) {
      if (error instanceof PodmanError && typeof error.exitCode === "number") {
        return { exitCode: error.exitCode, stdout: "", stderr: error.stderr ?? error.message, truncated: false };
      }
      throw error;
    }
  }

  async *logs(sandboxId: string, options: LogOptions = {}): AsyncIterable<LogEvent> {
    const name = await this.containerNameOf(sandboxId);
    const args = ["logs"];
    if (options.tail !== undefined) args.push("--tail", String(options.tail));
    if (options.follow) args.push("--follow");
    args.push("--timestamps", name);

    const stream = await this.runner.podmanStream(args);
    try {
      for await (const line of stream.stdout) {
        const [timestamp, ...rest] = line.split(" ");
        yield { timestamp: timestamp ?? nowIso(), stream: "stdout", text: rest.join(" ") };
      }
      for await (const line of stream.stderr) {
        const [timestamp, ...rest] = line.split(" ");
        yield { timestamp: timestamp ?? nowIso(), stream: "stderr", text: rest.join(" ") };
      }
    } finally {
      stream.cancel();
    }
  }

  async buildImage(spec: BuildImageSpec): Promise<ImageInfo> {
    // Build contexts use the RAW host path: the podman client converts
    // Windows paths natively (pre-translating here double-converts and
    // produces G:\mnt\g\... on Windows).
    const buildDir = spec.buildDir;
    const args = ["build", "--pull=missing", "-t", spec.imageRef];
    for (const [key, value] of Object.entries(spec.labels ?? {})) {
      args.push("--label", `${key}=${value}`);
    }
    args.push(buildDir);
    await this.runner.podman(args, { timeoutMs: 15 * 60_000, maxOutputBytes: 128 * 1024 });
    const image = await this.imageInfo(spec.imageRef);
    return image;
  }

  async pullImage(ref: string): Promise<ImageInfo> {
    await this.runner.podman(["pull", ref], { timeoutMs: 15 * 60_000, maxOutputBytes: 64 * 1024 });
    return this.imageInfo(ref);
  }

  async listPorts(sandboxId: string): Promise<PortInfo[]> {
    const name = await this.containerNameOf(sandboxId);
    const result = await this.runner.podman(["port", name], { timeoutMs: 30_000, reject: false });
    const ports: PortInfo[] = [];
    for (const line of result.stdout.split("\n")) {
      const match = line.match(/^(\d+)\/tcp\s*->\s*(?:(\d+\.\d+\.\d+\.\d+))?:(\d+)$/);
      if (match) {
        ports.push({
          containerPort: Number(match[1]),
          hostPort: Number(match[3]),
          bindHost: match[2] === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1",
        });
      }
    }
    return ports;
  }

  /* ------------------------------------------------------------------ */
  /* Internal helpers                                                    */
  /* ------------------------------------------------------------------ */

  private async initMachine(): Promise<void> {
    const options = { timeoutMs: this.machineTimeoutMs, maxOutputBytes: 64 * 1024 };
    try {
      // Podman >= 5.x: positional NAME.
      await this.runner.podman(["machine", "init", this.machineName], options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("unknown flag") || message.includes("Usage")) {
        // Older podman 4.x: --name flag.
        await this.runner.podman(["machine", "init", "--name", this.machineName], options);
        return;
      }
      throw error;
    }
  }

  private async info(): Promise<PodmanInfo> {
    const result = await this.runner.podman(["info", "--format", "json"], { timeoutMs: 30_000 });
    try {
      return JSON.parse(result.stdout) as PodmanInfo;
    } catch {
      throw new PodmanError("Could not parse `podman info` output", ["info"]);
    }
  }

  private async listMachines(): Promise<MachineRow[]> {
    try {
      const result = await this.runner.podman(["machine", "list", "--format", "json"], { timeoutMs: 30_000 });
      const parsed = JSON.parse(result.stdout) as MachineRow[] | MachineRow;
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  private async ensureVolume(volume: VolumeSpec, workspaceId: string): Promise<void> {
    const result = await this.runner.podman(["volume", "inspect", volume.name], { timeoutMs: 30_000, reject: false });
    if (result.exitCode === 0) return;
    await this.runner.podman(
      ["volume", "create", "--label", `pi-control.workspace=${workspaceId}`, volume.name],
      { timeoutMs: 30_000 },
    );
  }

  private async stateOf(containerName: string): Promise<string> {
    const result = await this.runner.podman(
      ["inspect", "--format", "{{.State.Status}}", containerName],
      { timeoutMs: 30_000, reject: false },
    );
    return result.stdout.trim();
  }

  private async containerNameOf(sandboxId: string): Promise<string> {
    const name = this.containerNames.get(sandboxId);
    if (!name) {
      throw new PodmanError(`Sandbox ${sandboxId} is not registered with the runtime`, []);
    }
    return name;
  }

  private async imageInfo(ref: string): Promise<ImageInfo> {
    const result = await this.runner.podman(
      ["image", "inspect", "--format", "{{.Id}} {{.Size}}", ref],
      { timeoutMs: 30_000 },
    );
    const [id, size] = result.stdout.trim().split(/\s+/);
    return { ref, id: id ?? ref, sizeBytes: size ? Number(size) : undefined };
  }

  /** Scratch dir helper used by the self-test. */
  static scratchDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }
}

function mapPodmanState(state: string): SandboxInfo["state"] {
  switch (state) {
    case "running":
      return "running";
    case "exited":
    case "stopped":
      return "stopped";
    case "paused":
      return "stopped";
    case "created":
      return "stopped";
    default:
      return "error";
  }
}
