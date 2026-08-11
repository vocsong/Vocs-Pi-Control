import { describe, expect, it } from "vitest";
import { RootlessPodmanRuntime } from "./runtime.js";
import { PodmanError, type PodmanRunner, type PodmanResult } from "./runner.js";

/** Fake runner that answers canned podman output and records calls. */
function fakeRunner(
  script: Array<{ match: (args: string[]) => boolean; result: PodmanResult }>,
): PodmanRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async podman(args, options) {
      calls.push(args);
      const entry = script.find((s) => s.match(args));
      if (!entry) throw new Error(`unexpected podman call: ${args.join(" ")}`);
      const result = entry.result;
      // Mimic the real runner: non-zero exit rejects unless reject:false.
      if (result.exitCode !== 0 && options?.reject !== false) {
        throw new PodmanError(result.stderr || `podman failed: ${args.join(" ")}`, args, result.exitCode, result.stderr);
      }
      return result;
    },
    async podmanStream() {
      throw new Error("podmanStream not used in this test");
    },
  };
}

const infoJson = JSON.stringify({
  host: { security: { rootless: true }, cpus: 8, memTotal: 16 * 1024 ** 3 },
});

describe("RootlessPodmanRuntime (fake runner)", () => {
  it("detects installed rootless podman on linux", async () => {
    const runner = fakeRunner([
      { match: (a) => a[0] === "--version", result: { stdout: "podman version 5.2.0", stderr: "", exitCode: 0, truncated: false } },
      { match: (a) => a[0] === "info", result: { stdout: infoJson, stderr: "", exitCode: 0, truncated: false } },
    ]);
    const rt = new RootlessPodmanRuntime({ runner, platform: "linux" });
    const detection = await rt.detect();
    expect(detection.detected).toBe(true);
    expect(detection.rootlessAvailable).toBe(true);
    expect(detection.machineRequired).toBe(false);
  });

  it("detects an unconfigured machine on win32", async () => {
    const runner = fakeRunner([
      { match: (a) => a[0] === "--version", result: { stdout: "podman version 5.2.0", stderr: "", exitCode: 0, truncated: false } },
      { match: (a) => a[0] === "machine", result: { stdout: "[]", stderr: "", exitCode: 0, truncated: false } },
    ]);
    const rt = new RootlessPodmanRuntime({ runner, platform: "win32" });
    const detection = await rt.detect();
    expect(detection.detected).toBe(true);
    expect(detection.machineRequired).toBe(true);
    expect(detection.machineConfigured).toBe(false);
    expect(detection.rootlessAvailable).toBe(false);
  });

  it("prepares a machine: create when missing, start, verify rootless", async () => {
    const runner = fakeRunner([
      { match: (a) => a[0] === "--version", result: { stdout: "podman version 5.2.0", stderr: "", exitCode: 0, truncated: false } },
      { match: (a) => a[0] === "machine" && a[1] === "list", result: { stdout: "[]", stderr: "", exitCode: 0, truncated: false } },
      { match: (a) => a[0] === "machine" && a[1] === "init", result: { stdout: "machine created", stderr: "", exitCode: 0, truncated: false } },
      { match: (a) => a[0] === "machine" && a[1] === "start", result: { stdout: "", stderr: "", exitCode: 0, truncated: false } },
      { match: (a) => a[0] === "info", result: { stdout: infoJson, stderr: "", exitCode: 0, truncated: false } },
    ]);
    const rt = new RootlessPodmanRuntime({ runner, platform: "win32", machineTimeoutMs: 5000 });
    const result = await rt.prepareHost();
    expect(result.ok).toBe(true);
    expect(result.machineStarted).toBe(true);
    expect(result.machineName).toBe("pi-control");
    expect(runner.calls.some((a) => a[0] === "machine" && a[1] === "init")).toBe(true);
  });

  it("creates a workspace: volumes first, then container with translated path", async () => {
    const runner = fakeRunner([
      { match: (a) => a[0] === "volume" && a[1] === "inspect", result: { stdout: "", stderr: "", exitCode: 1, truncated: false } },
      { match: (a) => a[0] === "volume" && a[1] === "create", result: { stdout: "vol", stderr: "", exitCode: 0, truncated: false } },
      { match: (a) => a[0] === "create", result: { stdout: "abc123", stderr: "", exitCode: 0, truncated: false } },
    ]);
    const rt = new RootlessPodmanRuntime({ runner, platform: "win32" });
    const info = await rt.createWorkspace({
      workspaceId: "ws_1",
      containerName: "pi-control-ws_1",
      imageRef: "pi-control/base:local",
      workspaceMount: { hostPath: "C:\\Projects\\app", containerPath: "/workspace" },
      volumes: [
        { name: "pi-control-ws_1-home", containerPath: "/home/pi", kind: "volume" },
        { name: "pi-control-ws_1-state", containerPath: "/state", kind: "volume" },
      ],
      resources: { cpuCores: 2, memoryGiB: 4, pidLimit: 512 },
      securityProfile: "standard",
    });

    expect(info.containerId).toBe("abc123");
    const createArgs = runner.calls.find((a) => a[0] === "create")!;
    expect(createArgs.join(" ")).toContain("--volume /mnt/c/Projects/app:/workspace");
    expect(createArgs.join(" ")).toContain("--memory 4294967296");
    expect(createArgs.join(" ")).toContain("--cpus 2");

    // registerSandbox enables later lifecycle calls
    rt.registerSandbox(info.id, "pi-control-ws_1");
  });

  it("reports capacity from podman info with local fallback", async () => {
    const runner = fakeRunner([
      { match: (a) => a[0] === "info", result: { stdout: infoJson, stderr: "", exitCode: 0, truncated: false } },
    ]);
    const rt = new RootlessPodmanRuntime({ runner, platform: "linux" });
    const capacity = await rt.capacity();
    expect(capacity.cpus).toBe(8);
    expect(capacity.memTotalBytes).toBe(16 * 1024 ** 3);
  });

  it("propagates podman errors as PodmanError", async () => {
    const runner = fakeRunner([
      { match: () => true, result: { stdout: "", stderr: "Error: no such container", exitCode: 125, truncated: false } },
    ]);
    const rt = new RootlessPodmanRuntime({ runner, platform: "linux" });
    rt.registerSandbox("sbx_1", "pi-control-ws_1");
    await expect(rt.inspect("sbx_1")).rejects.toThrow(/no such container/);
  });
});
