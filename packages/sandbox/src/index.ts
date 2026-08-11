/**
 * SandboxRuntime abstraction.
 *
 * V1 ships `RootlessPodmanRuntime`; `MockSandboxRuntime` powers ordinary unit
 * and frontend tests. The rest of Pi Control must never shell out to `podman`
 * directly — every container operation passes through this interface
 * (plan §6, ADR-0002).
 */

export type RuntimeName = "mock" | "podman";

export type SandboxState =
  | "missing"
  | "building"
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface RuntimeDetection {
  runtime: RuntimeName;
  detected: boolean;
  rootlessAvailable: boolean;
  machineRequired: boolean;
  machineConfigured: boolean;
  machineRunning: boolean;
  version?: string;
  messages: string[];
}

export interface PrepareResult {
  ok: boolean;
  machineName?: string;
  machineStarted: boolean;
  rootlessVerified: boolean;
  messages: string[];
}

export interface VolumeSpec {
  name: string;
  containerPath: string;
  /** Named volumes persist across container replacement. */
  kind: "volume" | "tmpfs";
}

export interface BindMountSpec {
  /** Host path — translated by the runtime adapter per platform. */
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

export interface CreateWorkspaceSandboxSpec {
  workspaceId: string;
  containerName: string;
  imageRef: string;
  /** Workspace bind mount (explicitly granted host folder). */
  workspaceMount: BindMountSpec;
  /** Private persistent state/cache/tools volumes. */
  volumes: VolumeSpec[];
  /** Resource limits (plan §17). */
  resources: {
    cpuCores: number;
    memoryGiB: number;
    pidLimit?: number;
  };
  securityProfile: "standard" | "restricted" | "trusted";
  /** Extra host mounts — must be explicitly granted; empty by default. */
  extraMounts?: BindMountSpec[];
  environment?: Record<string, string>;
}

export interface SandboxInfo {
  id: string;
  workspaceId: string;
  runtime: RuntimeName;
  containerName: string;
  containerId?: string;
  imageRef: string;
  state: SandboxState;
  securityProfile: string;
  createdAt: string;
  updatedAt: string;
  ports?: PortInfo[];
}

export interface SandboxExecRequest {
  command: string[];
  cwd?: string;
  environment?: Record<string, string>;
  /** Cap output in bytes; larger output is truncated. */
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export interface SandboxExecHandle {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface LogEvent {
  timestamp: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface LogOptions {
  tail?: number;
  follow?: boolean;
}

export interface PortInfo {
  containerPort: number;
  hostPort: number;
  /** Bound to loopback only unless explicitly granted otherwise. */
  bindHost: "127.0.0.1" | "0.0.0.0";
}

export interface BuildImageSpec {
  imageRef: string;
  buildDir: string;
  labels?: Record<string, string>;
}

export interface ImageInfo {
  ref: string;
  id: string;
  sizeBytes?: number;
  createdAt?: string;
}

export interface SandboxRuntime {
  readonly name: RuntimeName;
  detect(): Promise<RuntimeDetection>;
  prepareHost(): Promise<PrepareResult>;

  createWorkspace(spec: CreateWorkspaceSandboxSpec): Promise<SandboxInfo>;
  startWorkspace(sandboxId: string): Promise<void>;
  stopWorkspace(sandboxId: string): Promise<void>;
  removeWorkspace(sandboxId: string): Promise<void>;

  inspect(sandboxId: string): Promise<SandboxInfo>;

  exec(sandboxId: string, request: SandboxExecRequest): Promise<SandboxExecHandle>;
  logs(sandboxId: string, options?: LogOptions): AsyncIterable<LogEvent>;

  buildImage(spec: BuildImageSpec): Promise<ImageInfo>;
  pullImage(ref: string): Promise<ImageInfo>;

  listPorts(sandboxId: string): Promise<PortInfo[]>;
}

export type SandboxRuntimeFactory = () => SandboxRuntime;
