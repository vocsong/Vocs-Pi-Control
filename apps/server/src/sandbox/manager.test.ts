import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, schema, type Db } from "@pi-control/database";
import { EVENT_TYPES } from "@pi-control/protocol";
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
  it("syncs folders from the root and ignores symlinks (#2)", () => {
    const { db, manager } = makeManager();
    mkdirSync(path.join(scratch, "real-a"));
    const outside = mkdtempSync(path.join(tmpdir(), "pic-outside-"));
    try {
      if (process.platform !== "win32") symlinkSync(outside, path.join(scratch, "link-b"), "dir");
      const created = manager.syncWorkspacesFromRoot();
      expect(created).toBe(1);
      const rows = db.select().from(schema.projects).all();
      expect(rows.map((r) => r.name)).toEqual(["real-a"]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("publishes the same workspace id it persists during sync (#6)", () => {
    const { db, hub, manager } = makeManager();
    mkdirSync(path.join(scratch, "folder-a"));
    const received: Array<Record<string, unknown>> = [];
    hub.attach({
      send: (data: string) => received.push(JSON.parse(data) as Record<string, unknown>),
    } as never);
    expect(manager.syncWorkspacesFromRoot()).toBe(1);
    const row = db.select().from(schema.projects).where(eq(schema.projects.name, "folder-a")).get();
    const event = received.find((e) => e.type === EVENT_TYPES.workspaceCreated);
    const workspace = (event?.payload as { workspace: { id: string } }).workspace;
    expect(workspace.id).toBe(row?.id);
  });

  it("reuses freed dev-port slots and keeps per-sandbox allocation (#10)", async () => {
    const { manager } = makeManager();
    mkdirSync(path.join(scratch, "a"));
    mkdirSync(path.join(scratch, "b"));
    mkdirSync(path.join(scratch, "c"));
    const a = (await manager.createWorkspace({ name: "a", hostRootPath: path.join(scratch, "a") })).sandbox;
    const b = (await manager.createWorkspace({ name: "b", hostRootPath: path.join(scratch, "b") })).sandbox;
    expect(a.devHostStart).toBe(43100);
    expect(b.devHostStart).toBe(43120);
    await manager.removeSandbox(a.id);
    const c = (await manager.createWorkspace({ name: "c", hostRootPath: path.join(scratch, "c") })).sandbox;
    expect(c.devHostStart).toBe(43100);
    // b keeps its slot after a new sandbox is created.
    expect((await manager.sandboxInfo(b.id)).devHostStart).toBe(43120);
  });

  it("claims legacy configJson dev-port slots at boot (#10)", async () => {
    const { db, manager } = makeManager();
    mkdirSync(path.join(scratch, "app"));
    const w = (await manager.createWorkspace({ name: "app", hostRootPath: path.join(scratch, "app") })).sandbox;
    // Simulate a legacy record: configJson has the slot, the table does not.
    db.delete(schema.devPortSlots).where(eq(schema.devPortSlots.sandboxId, w.id)).run();
    expect(manager.seedLegacyDevSlots()).toBeGreaterThan(0);
    const row = db.select().from(schema.devPortSlots).where(eq(schema.devPortSlots.sandboxId, w.id)).get();
    expect(row?.slot).toBe(0);
    // A new sandbox must not collide with the seeded legacy slot.
    mkdirSync(path.join(scratch, "b"));
    const b = (await manager.createWorkspace({ name: "b", hostRootPath: path.join(scratch, "b") })).sandbox;
    expect(b.devHostStart).toBe(43120);
  });

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
