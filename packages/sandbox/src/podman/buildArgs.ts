/**
 * Pure builder for `podman create` arguments.
 *
 * Kept dependency-free and side-effect-free so the security-relevant flag
 * set is unit-testable without a Podman installation (plan §8, §43).
 */

import type { BindMountSpec, VolumeSpec } from "../index.js";

export interface CreateContainerOptions {
  containerName: string;
  imageRef: string;
  workspaceMount: BindMountSpec;
  volumes: VolumeSpec[];
  tmpfsPaths: string[];
  resources: { cpus: number; memoryBytes: number; pidLimit?: number };
  securityProfile: "standard" | "restricted" | "trusted";
  environment?: Record<string, string>;
  ports?: { hostPort: number; containerPort: number }[];
  command?: string[];
  workdir?: string;
}

/** Non-negotiable flags from plan §43 — enforced here, not just documented. */
export function buildCreateArgs(options: CreateContainerOptions): string[] {
  const args: string[] = ["create"];

  args.push("--name", options.containerName);
  args.push("--label", "pi-control.managed=true");

  // Workspace bind mount: the ONLY host path by default.
  args.push(
    "--volume",
    mountArg(options.workspaceMount.hostPath, options.workspaceMount.containerPath, options.workspaceMount.readonly),
  );

  // Named volumes for private persistent state.
  for (const volume of options.volumes) {
    args.push("--volume", `${volume.name}:${volume.containerPath}`);
  }

  for (const tmpfsPath of options.tmpfsPaths) {
    args.push("--tmpfs", tmpfsPath);
  }

  // Resource limits (plan §17).
  args.push("--cpus", String(options.resources.cpus));
  args.push("--memory", String(options.resources.memoryBytes));
  if (options.resources.pidLimit !== undefined) {
    args.push("--pids-limit", String(options.resources.pidLimit));
  }

  // Security posture (plan §8, §43):
  // No --privileged, no --network host, no --pid host, no --ipc host,
  // no --device, no socket mounts. no-new-privileges always on.
  args.push("--security-opt", "no-new-privileges");

  if (options.securityProfile === "restricted") {
    // Read-only root filesystem; workspace + named volumes + tmpfs stay writable.
    args.push("--read-only");
  }

  if (options.environment) {
    for (const [key, value] of Object.entries(options.environment)) {
      args.push("--env", `${key}=${value}`);
    }
  }

  // Loopback-only port forwarding (plan §16.2).
  if (options.ports) {
    for (const port of options.ports) {
      args.push("--publish", `127.0.0.1:${port.hostPort}:${port.containerPort}`);
    }
  }

  if (options.workdir) args.push("--workdir", options.workdir);

  // Pull only when the image is missing locally.
  args.push("--pull", "missing");

  args.push(options.imageRef);

  // Default keep-alive command; Phase 2 replaces it with the workspace agent.
  args.push(...(options.command ?? ["sleep", "infinity"]));

  return args;
}

function mountArg(hostPath: string, containerPath: string, readonly?: boolean): string {
  return `${hostPath}:${containerPath}${readonly ? ":ro" : ""}`;
}
