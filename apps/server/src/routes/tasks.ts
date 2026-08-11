import { z } from "zod";
import { schema, type Db } from "@pi-control/database";
import { desc, eq } from "drizzle-orm";
import { EVENT_TYPES, type TaskInfo, type TaskStatus } from "@pi-control/protocol";
import { newId, nowIso } from "@pi-control/shared";
import type { AppFastify } from "../types.js";
import type { RealtimeHub } from "../realtime/hub.js";

const createBody = z
  .object({ title: z.string().min(1).max(500), description: z.string().max(5000).optional() })
  .strict();

const updateBody = z
  .object({
    status: z.enum(["todo", "running", "blocked", "done", "failed"]).optional(),
    assignedSessionId: z.string().min(1).max(128).nullable().optional(),
  })
  .strict();

export function registerTaskRoutes(app: AppFastify, db: Db, hub: RealtimeHub): void {
  app.get("/api/workspaces/:workspaceId/tasks", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const rows = db.select().from(schema.tasks).where(eq(schema.tasks.workspaceId, workspaceId)).orderBy(desc(schema.tasks.createdAt)).all();
    return { tasks: rows.map(toTaskInfo) };
  });

  app.post("/api/workspaces/:workspaceId/tasks", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = createBody.parse(request.body);
    const now = nowIso();
    const row = {
      id: newId("task"),
      workspaceId,
      title: body.title,
      description: body.description ?? null,
      status: "todo",
      assignedSessionId: null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(schema.tasks).values(row).run();
    const info = toTaskInfo(row);
    hub.publish({ scope: "workspace", workspaceId, type: EVENT_TYPES.taskCreated, payload: { task: info } });
    return reply.code(201).send({ task: info });
  });

  app.patch("/api/tasks/:taskId", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = updateBody.parse(request.body);
    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const row = {
      ...existing,
      status: body.status ?? existing.status,
      assignedSessionId: body.assignedSessionId === undefined ? existing.assignedSessionId : body.assignedSessionId,
      updatedAt: nowIso(),
    };
    db.update(schema.tasks).set(row).where(eq(schema.tasks.id, taskId)).run();
    const info = toTaskInfo(row);
    hub.publish({
      scope: "workspace",
      workspaceId: existing.workspaceId,
      type: EVENT_TYPES.taskUpdated,
      payload: { task: info },
    });
    return { task: info };
  });
}

function toTaskInfo(row: {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: string;
  assignedSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}): TaskInfo {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as TaskStatus,
    assignedSessionId: row.assignedSessionId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
