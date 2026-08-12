import { describe, expect, it } from "vitest";
import { openDb, schema, type Db } from "@pi-control/database";
import { recordTraceEvent } from "./trace.js";
import type { EventEnvelopeInit } from "@pi-control/protocol";

function openTestDb(): Db {
  const db = openDb(":memory:");
  const now = new Date().toISOString();
  db.insert(schema.machines)
    .values({
      id: "machine_local",
      name: "test machine",
      kind: "local",
      hostname: "test",
      platform: "linux",
      status: "online",
      capabilitiesJson: "{}",
      createdAt: now,
    })
    .run();
  db.insert(schema.projects)
    .values({
      id: "ws_1",
      machineId: "machine_local",
      name: "app",
      hostRootPath: "/tmp/app",
      createdAt: now,
    })
    .run();
  db.insert(schema.workspaces)
    .values({
      id: "sbx_1",
      projectId: "ws_1",
      machineId: "machine_local",
      name: "app",
      hostPath: "/tmp/app",
      sandboxId: "container-1",
      createdAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: "session_ws",
      workspaceId: "sbx_1",
      title: "Workspace session",
      status: "idle",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: "session_mock",
      workspaceId: null,
      title: "Mock session",
      status: "idle",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return db;
}

function envelope(sessionId: string, type: string, payload: Record<string, unknown>): EventEnvelopeInit {
  return { scope: "session", sessionId, type, payload };
}

describe("recordTraceEvent", () => {
  it("persists a user prompt row with the owning workspace id (#13)", () => {
    const db = openTestDb();
    recordTraceEvent(db, envelope("session_ws", "user.message", { messageId: "m1", content: "hello pi" }));
    const rows = db.select().from(schema.traces).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "m1",
      workspaceId: "sbx_1",
      sessionId: "session_ws",
      type: "user.prompt",
      status: "done",
    });
    expect(JSON.parse(rows[0]!.metadataJson ?? "{}")).toEqual({ text: "hello pi" });
  });

  it("merges tool.start and tool.end into one finished row (#13)", () => {
    const db = openTestDb();
    recordTraceEvent(db, envelope("session_ws", "tool.start", { toolCallId: "t1", name: "bash", input: "ls" }));
    recordTraceEvent(db, envelope("session_ws", "tool.end", { toolCallId: "t1", durationMs: 12 }));
    const rows = db.select().from(schema.traces).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "t1", type: "tool.bash", status: "done" });
    expect(rows[0]!.finishedAt).toBeTruthy();
    expect(JSON.parse(rows[0]!.metadataJson ?? "{}")).toEqual({ durationMs: 12 });
  });

  it("skips server-side (mock) sessions that have no workspace (#13)", () => {
    const db = openTestDb();
    recordTraceEvent(db, envelope("session_mock", "user.message", { messageId: "m2", content: "x" }));
    expect(db.select().from(schema.traces).all()).toHaveLength(0);
  });
});
