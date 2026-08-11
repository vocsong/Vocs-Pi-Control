import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, schema, type Db } from "@pi-control/database";
import { MockSandboxRuntime } from "@pi-control/sandbox/mock";
import { RealtimeHub } from "../realtime/hub.js";
import { createLogger } from "../logger.js";
import { AgentManager } from "../agents/agentManager.js";
import { SandboxManager } from "./manager.js";

function openTestDb(): Db {
  const db = openDb(":memory:");
  db.insert(schema.machines)
    .values({
      id: "machine_local",
      name: "test machine",
      kind: "local",
      hostname: "test",
      platform: "linux",
      status: "online",
      capabilitiesJson: "{}",
      createdAt: new Date().toISOString(),
    })
    .run();
  return db;
}

function makeManager(db: Db = openTestDb()) {
  const logger = createLogger("silent");
  const hub = new RealtimeHub(logger);
  const agents = new AgentManager(hub, logger);
  const manager = new SandboxManager({
    db,
    runtime: new MockSandboxRuntime({ speedMs: 0 }),
    hub,
    logger,
    agents,
    baseImage: "pi-control/base:local",
    imagesDir: process.cwd(),
    rootFolder: () => scratch,
  });
  return { db, hub, agents, manager };
}

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "pic-manager-test-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("SandboxManager", () => {
  it("creates a project from a real directory", async () => {
    const { manager } = makeManager();
    const project = (await manager.createWorkspace({ name: "app", hostRootPath: scratch })).workspace;
    expect(project.id).toMatch(/^ws_/);
    expect(manager.listWorkspaces()).toHaveLength(1);
  });

  it("rejects non-existent project paths", async () => {
    const { manager } = makeManager();
    await expect(manager.createWorkspace({ name: "nope", hostRootPath: path.join(scratch, "missing") })).rejects.toThrow();
  });

  it("creates a workspace with a sandbox and walks its lifecycle", async () => {
    const { manager, hub } = makeManager();

    const events: string[] = [];
    hub.attach({ send: (data) => events.push((JSON.parse(data) as { type: string }).type) });

    const { workspace, sandbox } = await manager.createWorkspace({ name: "app", hostRootPath: scratch });
    expect(sandbox.id).toMatch(/^sbx_/);
    expect(sandbox.securityProfile).toBe("standard");
    expect(sandbox.status).toBeDefined();
    expect(events).toContain("sandbox.created");
    expect(events).toContain("sandbox.state");

    const started = await manager.startSandbox(sandbox.id);
    expect(started.status).toBe("running");

    const stopped = await manager.stopSandbox(sandbox.id);
    expect(stopped.status).toBe("stopped");

    await manager.removeSandbox(sandbox.id);
    const after = await manager.sandboxInfo(sandbox.id);
    expect(after.archivedAt).toBeDefined();
  });

  it("reports sandbox status and runs the security self-test on the mock runtime", async () => {
    const { manager } = makeManager();
    const detection = await manager.refreshDetection();
    expect(detection.detected).toBe(true);

    const status = manager.statusPayload(detection);
    expect(status?.runtime).toBe("mock");

    const result = await manager.selfTest();
    expect(result.ok).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it("restores sandbox registrations from the database after a restart", async () => {
    const db = openTestDb();
    const first = makeManager(db).manager;
    const { sandbox } = await first.createWorkspace({ name: "app", hostRootPath: scratch });
    await first.startSandbox(sandbox.id);

    // Simulate restart: a fresh manager over the same database.
    const { manager: restarted } = makeManager(db);
    restarted.restoreSandboxes();
    const started = await restarted.startSandbox(sandbox.id);
    expect(started.status).toBe("running");
  });
});
