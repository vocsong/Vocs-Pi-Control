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
  it("creates a project from a real directory", () => {
    const { manager } = makeManager();
    const project = manager.createProject({ name: "app", hostRootPath: scratch });
    expect(project.id).toMatch(/^proj_/);
    expect(manager.listProjects()).toHaveLength(1);
  });

  it("rejects non-existent project paths", () => {
    const { manager } = makeManager();
    expect(() => manager.createProject({ name: "nope", hostRootPath: path.join(scratch, "missing") })).toThrow();
  });

  it("creates a workspace with a sandbox and walks its lifecycle", async () => {
    const { manager, hub } = makeManager();

    const events: string[] = [];
    hub.attach({ send: (data) => events.push((JSON.parse(data) as { type: string }).type) });

    const project = manager.createProject({ name: "app", hostRootPath: scratch });
    const workspace = await manager.createWorkspace(project.id, { name: "main", hostPath: scratch });
    expect(workspace.id).toMatch(/^ws_/);
    expect(workspace.securityProfile).toBe("standard");
    expect(workspace.sandboxId).toBeDefined();
    expect(events).toContain("workspace.created");
    expect(events).toContain("workspace.state");

    const started = await manager.startWorkspace(workspace.id);
    expect(started.status).toBe("running");

    const stopped = await manager.stopWorkspace(workspace.id);
    expect(stopped.status).toBe("stopped");

    await manager.removeWorkspace(workspace.id);
    const after = await manager.workspaceInfo(workspace.id);
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
    const project = first.createProject({ name: "app", hostRootPath: scratch });
    const workspace = await first.createWorkspace(project.id, { name: "main", hostPath: scratch });
    await first.startWorkspace(workspace.id);

    // Simulate restart: a fresh manager over the same database.
    const { manager: restarted } = makeManager(db);
    restarted.restoreSandboxes();
    const started = await restarted.startWorkspace(workspace.id);
    expect(started.status).toBe("running");
  });
});
