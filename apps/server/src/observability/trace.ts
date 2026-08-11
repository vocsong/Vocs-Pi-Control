/**
 * TraceRecorder — control-plane observability baseline (plan §38).
 *
 * Derives trace rows from the session event stream (both mock and
 * workspace sessions): user prompts, assistant runs, and tool executions
 * with durations. Rows use natural keys (message/toolCall ids) so
 * start/end pairs merge.
 */

import { schema, type Db } from "@pi-control/database";
import { eq } from "drizzle-orm";
import { nowIso } from "@pi-control/shared";
import type { EventEnvelopeInit } from "@pi-control/protocol";

export function recordTraceEvent(db: Db, envelope: EventEnvelopeInit): void {
  const sessionId = envelope.sessionId;
  if (!sessionId) return;
  const payload = envelope.payload as Record<string, unknown>;
  const workspaceId = (payload.workspaceId as string | undefined) ?? null;

  const insert = (id: string, type: string, status: string, metadata?: unknown, startedAt?: string): void => {
    try {
      db.insert(schema.traces)
        .values({
          id,
          workspaceId: workspaceId ?? "unknown",
          sessionId,
          type,
          startedAt: startedAt ?? nowIso(),
          status,
          metadataJson: metadata === undefined ? null : JSON.stringify(metadata),
        })
        .onConflictDoNothing()
        .run();
    } catch {
      // observability must never break the control flow
    }
  };

  const finish = (id: string, status: string): void => {
    try {
      db.update(schema.traces)
        .set({ finishedAt: nowIso(), status })
        .where(eq(schema.traces.id, id))
        .run();
    } catch {
      // ignore
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
      } catch {
        // ignore
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
