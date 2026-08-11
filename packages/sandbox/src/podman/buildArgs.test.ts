import { describe, expect, it } from "vitest";
import { buildCreateArgs } from "./buildArgs.js";

const BASE = {
  containerName: "pi-control-ws_abc",
  imageRef: "pi-control/base:local",
  workspaceMount: { hostPath: "/Projects/app", containerPath: "/workspace" },
  volumes: [
    { name: "pi-control-ws_abc-home", containerPath: "/home/pi", kind: "volume" as const },
    { name: "pi-control-ws_abc-state", containerPath: "/state", kind: "volume" as const },
  ],
  tmpfsPaths: ["/tmp", "/run"],
  resources: { cpus: 4, memoryBytes: 8 * 1024 ** 3, pidLimit: 512 },
  securityProfile: "standard" as const,
};

describe("buildCreateArgs", () => {
  it("mounts the workspace and named volumes", () => {
    const args = buildCreateArgs(BASE);
    const joined = args.join(" ");
    expect(joined).toContain(`--volume /Projects/app:/workspace`);
    expect(joined).toContain(`--volume pi-control-ws_abc-home:/home/pi`);
    expect(joined).toContain(`--volume pi-control-ws_abc-state:/state`);
  });

  it("enforces the non-negotiable security posture", () => {
    const joined = buildCreateArgs(BASE).join(" ");
    expect(joined).not.toContain("--privileged");
    expect(joined).not.toContain("--network host");
    expect(joined).not.toContain("--pid host");
    expect(joined).not.toContain("--ipc host");
    expect(joined).not.toContain("--device");
    expect(joined).not.toContain("podman.sock");
    expect(joined).not.toContain("docker.sock");
    expect(joined).toContain("--security-opt no-new-privileges");
    expect(joined).toContain("--label pi-control.managed=true");
  });

  it("applies resource limits", () => {
    const joined = buildCreateArgs(BASE).join(" ");
    expect(joined).toContain("--cpus 4");
    expect(joined).toContain(`--memory ${8 * 1024 ** 3}`);
    expect(joined).toContain("--pids-limit 512");
  });

  it("adds --read-only for the restricted profile", () => {
    const args = buildCreateArgs({ ...BASE, securityProfile: "restricted" });
    expect(args).toContain("--read-only");
    expect(buildCreateArgs(BASE)).not.toContain("--read-only");
  });

  it("sets tmpfs for /tmp and /run", () => {
    const args = buildCreateArgs(BASE);
    expect(args).toContain("--tmpfs");
    expect(args.filter((a) => a === "/tmp" || a === "/run")).toEqual(["/tmp", "/run"]);
  });

  it("forwards loopback-only ports", () => {
    const args = buildCreateArgs({ ...BASE, ports: [{ hostPort: 5173, containerPort: 5173 }] });
    expect(args).toContain("--publish");
    expect(args.join(" ")).toContain("127.0.0.1:5173:5173");
  });

  it("keeps the container alive with the default command", () => {
    const args = buildCreateArgs(BASE);
    expect(args.slice(-2)).toEqual(["sleep", "infinity"]);
  });
});
