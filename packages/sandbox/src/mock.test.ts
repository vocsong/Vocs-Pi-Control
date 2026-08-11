import { describe, expect, it } from "vitest";
import { MockSandboxRuntime } from "./mock.js";

const BASE_SPEC = {
  workspaceId: "ws_test",
  containerName: "pi-control-ws-test",
  imageRef: "pi-control/base:latest",
  workspaceMount: { hostPath: "C:/Projects/app", containerPath: "/workspace" },
  volumes: [
    { name: "pi-control-ws-test-home", containerPath: "/home/pi", kind: "volume" as const },
    { name: "pi-control-ws-test-state", containerPath: "/state", kind: "volume" as const },
  ],
  resources: { cpuCores: 4, memoryGiB: 8 },
  securityProfile: "standard" as const,
};

describe("MockSandboxRuntime", () => {
  it("reports detection and prepare results", async () => {
    const rt = new MockSandboxRuntime();
    const detection = await rt.detect();
    expect(detection.detected).toBe(true);
    expect(detection.rootlessAvailable).toBe(true);
    const prepare = await rt.prepareHost();
    expect(prepare.ok).toBe(true);
  });

  it("walks the workspace lifecycle: create -> start -> stop -> remove", async () => {
    const rt = new MockSandboxRuntime({ speedMs: 0 });
    const info = await rt.createWorkspace(BASE_SPEC);
    expect(info.state).toBe("stopped");
    expect(info.workspaceId).toBe("ws_test");

    await rt.startWorkspace(info.id);
    expect(rt.stateOf(info.id)).toBe("running");

    const inspected = await rt.inspect(info.id);
    expect(inspected.containerId).toBeTruthy();

    await rt.stopWorkspace(info.id);
    expect(rt.stateOf(info.id)).toBe("stopped");

    await rt.removeWorkspace(info.id);
    expect(rt.stateOf(info.id)).toBeUndefined();
  });

  it("executes commands and lists ports", async () => {
    const rt = new MockSandboxRuntime({ speedMs: 0 });
    const info = await rt.createWorkspace(BASE_SPEC);
    const exec = await rt.exec(info.id, { command: ["npm", "test"], cwd: "/workspace" });
    expect(exec.exitCode).toBe(0);
    expect(exec.stdout).toContain("npm test");
    expect(await rt.listPorts(info.id)).toEqual([]);
  });
});
