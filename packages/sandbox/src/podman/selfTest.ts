/**
 * Sandbox security self-test (plan §50).
 *
 * Proves, on the real runtime, that a default workspace container:
 *   - launches and mounts the workspace folder as /workspace (RW);
 *   - cannot see the host home directory;
 *   - has no Podman/Docker socket;
 *   - runs non-privileged.
 *
 * Runs a throwaway scratch container and cleans up afterwards.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newId } from "@pi-control/shared";
import type { SandboxRuntime } from "../index.js";
import { translateHostPath } from "./paths.js";

export interface SelfTestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestResult {
  ok: boolean;
  checks: SelfTestCheck[];
  startedAt: string;
  finishedAt: string;
}

export interface SelfTestOptions {
  /** Image to test with; must provide `sh`. Default pulls a small image. */
  imageRef?: string;
  /** A ready runtime (podman or mock). */
  runtime: SandboxRuntime;
  /** Host home dir whose absence must be proven inside the container. */
  hostHomeDir?: string;
}

export async function runSecuritySelfTest(options: SelfTestOptions): Promise<SelfTestResult> {
  const imageRef = options.imageRef ?? "docker.io/library/alpine:latest";
  const hostHomeDir = options.hostHomeDir ?? os.homedir();
  const checks: SelfTestCheck[] = [];
  const startedAt = new Date().toISOString();
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-control-selftest-"));
  const scratchWorkspace = path.join(scratchRoot, "workspace");
  fs.mkdirSync(scratchWorkspace, { recursive: true });
  const sandboxId = newId("sbx");
  const containerName = `pi-control-selftest-${sandboxId.slice(4, 12)}`;

  // The host-home probe must use the path as seen INSIDE the container:
  // on Windows/macOS machines the host home lives under /mnt/<drive> and is
  // NOT mounted — but a bare "C:\..." string or container-local /home is
  // meaningless as a probe.
  const hostHomeProbe = translateHostPath(hostHomeDir, { homeDir: hostHomeDir }).machinePath;
  const driveRootProbe = hostHomeProbe.split("/").slice(0, 3).join("/");

  const record = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  const check = async (name: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<void> => {
    try {
      const result = await fn();
      record(name, result.ok, result.detail);
    } catch (error) {
      record(name, false, error instanceof Error ? error.message : String(error));
    }
  };

  try {
    await check("image availability", async () => {
      await options.runtime.pullImage(imageRef);
      return { ok: true, detail: imageRef };
    });

    await check("container creation", async () => {
      const info = await options.runtime.createWorkspace({
        workspaceId: `selftest_${sandboxId}`,
        containerName,
        imageRef,
        workspaceMount: { hostPath: scratchWorkspace, containerPath: "/workspace" },
        volumes: [],
        resources: { cpuCores: 1, memoryGiB: 1, pidLimit: 128 },
        securityProfile: "standard",
      });
      options.runtime.registerSandbox(sandboxId, containerName);
      return { ok: true, detail: info.containerId ?? "" };
    });

    await check("container start", async () => {
      await options.runtime.startWorkspace(sandboxId);
      return { ok: true, detail: "running" };
    });

    await check("/workspace bind mount is writable", async () => {
      const result = await options.runtime.exec(sandboxId, {
        command: ["sh", "-c", "echo pi-control-selftest > /workspace/.selftest && cat /workspace/.selftest"],
      });
      const ok = result.exitCode === 0 && result.stdout.trim() === "pi-control-selftest";
      return { ok, detail: ok ? "write+read ok" : result.stderr };
    });

    await check("runs as an unprivileged user", async () => {
      const result = await options.runtime.exec(sandboxId, { command: ["sh", "-c", "id -u"] });
      const ok = result.exitCode === 0 && result.stdout.trim() !== "0";
      return { ok, detail: ok ? `uid ${result.stdout.trim()}` : result.stderr };
    });

    await check("has no effective capabilities", async () => {
      const result = await options.runtime.exec(sandboxId, {
        command: ["sh", "-c", "grep CapEff /proc/self/status | awk '{print $2}'"],
      });
      const eff = result.stdout.trim();
      const ok = result.exitCode === 0 && /^0+$/.test(eff);
      return { ok, detail: ok ? `CapEff ${eff}` : result.stderr };
    });

    await check("host home directory is absent", async () => {
      const command = `test ! -e '${hostHomeProbe}' && test ! -e '${driveRootProbe}' && echo absent`;
      const result = await options.runtime.exec(sandboxId, { command: ["sh", "-c", command] });
      const ok = result.exitCode === 0 && result.stdout.trim() === "absent";
      return { ok, detail: ok ? `${hostHomeProbe} absent` : `probe failed: ${result.stderr}` };
    });

    await check("Podman socket is absent", async () => {
      const result = await options.runtime.exec(sandboxId, {
        command: ["sh", "-c", "test ! -e /run/podman/podman.sock && test ! -e /var/run/docker.sock && echo absent"],
      });
      const ok = result.exitCode === 0 && result.stdout.trim() === "absent";
      return { ok, detail: ok ? "sockets absent" : `probe failed: ${result.stderr}` };
    });

    await check("no arbitrary host mounts beyond /workspace", async () => {
      const result = await options.runtime.exec(sandboxId, { command: ["sh", "-c", "cat /proc/mounts"] });
      if (result.exitCode !== 0) return { ok: false, detail: result.stderr };
      // The workspace mount itself may legitimately reference host paths
      // (e.g. "C:\..." sources on Windows 9p mounts) — ignore it.
      const foreign = result.stdout
        .split("\n")
        .filter((line) => !line.includes(" /workspace "))
        .filter(
          (line) =>
            line.startsWith("/mnt/") ||
            line.includes("C:\\") ||
            line.includes("path=C:") ||
            line.includes(" /Users/") ||
            line.includes(" /home/"),
        );
      return { ok: foreign.length === 0, detail: foreign.length === 0 ? "only /workspace host mount" : foreign.join("\n") };
    });

    await check("cleanup", async () => {
      await options.runtime.removeWorkspace(sandboxId);
      fs.rmSync(scratchRoot, { recursive: true, force: true });
      return { ok: true, detail: "container and scratch removed" };
    });
  } catch (error) {
    record("self-test run", false, error instanceof Error ? error.message : String(error));
    try {
      await options.runtime.removeWorkspace(sandboxId);
    } catch {
      // best-effort cleanup
    }
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
