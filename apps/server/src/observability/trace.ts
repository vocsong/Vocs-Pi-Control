/**
 * TraceRecorder — control-plane observability baseline (plan §38).
 *
 * Derives trace rows from the session event stream (both mock and
 * workspace sessions): user prompts, assistant runs, and tool executions
 * with durations. Rows use natural keys (message/toolCall ids) so
 * start/end pairs merge.
 *
 * Privacy policy: traces store metadata plus truncated prompt text and
 * tool inputs for LOCAL troubleshooting only; transcripts themselves stay
 * in the native Pi session files and are never duplicated here. Retention
 * is tied to the control-plane database lifetime.
 */

import { schema, type Db } from "@pi-control/database";
import { eq } from "drizzle-orm";
import { nowIso } from "@pi-control/shared";
import type { EventEnvelopeInit } from "@pi-control/protocol";
import type { Logger } from "../logger.js";

export function recordTraceEvent(db: Db, envelope: EventEnvelopeInit, logger?: Logger): void {
  const sessionId = envelope.sessionId;
  if (!sessionId) return;

  // Event payloads do not carry workspaceId and traces.workspace_id is a
  // required foreign key into workspaces, so resolve ownership from the
  // authoritative session record. Server-side (mock) sessions have no
  // sandbox and are skipped — there is nothing to reference.
  let workspaceId: string | null = null;
  try {
    const row = db
      .select({ workspaceId: schema.sessions.workspaceId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    workspaceId = row?.workspaceId ?? null;
  } catch (error) {
    logger?.warn({ error: String(error), sessionId }, "trace: session lookup failed");
    return;
  }
  if (!workspaceId) return;

  const payload = envelope.payload as Record<string, unknown>;

  const insert = (id: string, type: string, status: string, metadata?: unknown, startedAt?: string): void => {
    try {
      db.insert(schema.traces)
        .values({
          id,
          workspaceId,
          sessionId,
          type,
          startedAt: startedAt ?? nowIso(),
          status,
          metadataJson: metadata === undefined ? null : JSON.stringify(metadata),
        })
        .onConflictDoNothing()
        .run();
    } catch (error) {
      // Observability must never break the control flow, but failures
      // must stay observable instead of vanishing silently (#13).
      logger?.warn({ error: String(error), sessionId, traceType: type }, "trace: insert failed");
    }
  };

  const finish = (id: string, status: string): void => {
    try {
      db.update(schema.traces)
        .set({ finishedAt: nowIso(), status })
        .where(eq(schema.traces.id, id))
        .run();
    } catch (error) {
      logger?.warn({ error: String(error), sessionId, traceId: id }, "trace: update failed");
    }
  };

  switch (envelope.type) {
    case "user.message": {
      const messageId = payload.messageId as string;
      insert(messageId, "user.prompt", "done", { text: String(payload.content ?? "").slice(0, 500) });
      return;
    }
    case "assistant.start": {
      insert(payload.messageId as string, "assistant.run", "running", undefined, undefined);
      return;
    }
    case "assistant.end": {
      finish(payload.messageId as string, "done");
      return;
    }
    case "tool.start": {
      insert(
        payload.toolCallId as string,
        `tool.${String(payload.name ?? "unknown")}`,
        "running",
        { input: payload.input },
      );
      return;
    }
    case "tool.end": {
      try {
        db.update(schema.traces)
          .set({
            finishedAt: nowIso(),
            status: "done",
            metadataJson: JSON.stringify({ durationMs: payload.durationMs }),
          })
          .where(eq(schema.traces.id, payload.toolCallId as string))
          .run();
      } catch (error) {
        logger?.warn({ error: String(error), sessionId, traceId: payload.toolCallId }, "trace: tool update failed");
      }
      return;
    }
    case "tool.error": {
      finish(payload.toolCallId as string, "error");
      return;
    }
    default:
      return;
  }
}
