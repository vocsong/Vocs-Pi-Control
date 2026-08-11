/**
 * SessionManager — owns Pi session lifecycle on the control server.
 *
 * Each session gets a PiSessionDriver instance (MockPiDriver in Phase 0,
 * EmbeddedPiDriver in Phase 3). Driver events are normalized into protocol
 * envelopes and published through the RealtimeHub (ADR-0007).
 */

import { schema, type Db } from "@pi-control/database";
import { eq, desc, isNull } from "drizzle-orm";
import {
  EVENT_TYPES,
  type EventEnvelopeInit,
  type SessionInfo,
  type SessionStatus,
  type UsageInfo,
} from "@pi-control/protocol";
import {
  type PiDriverEvent,
  type PiDriverFactory,
  type PiSessionDriver,
} from "@pi-control/pi-driver";
import { newId, nowIso } from "@pi-control/shared";
import type { RealtimeHub } from "../realtime/hub.js";
import type { Logger } from "../logger.js";

export interface CreateSessionInput {
  title?: string;
  model?: string;
  thinkingLevel?: string;
}

interface DriverMapping {
  driver: PiSessionDriver;
  driverSessionId: string;
  usage?: UsageInfo;
}

export class SessionManager {
  private readonly drivers = new Map<string, DriverMapping>();
  private readonly checkpoints = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly hub: RealtimeHub,
    private readonly driverFactory: PiDriverFactory,
    private readonly logger: Logger,
  ) {}

  async createSession(input: CreateSessionInput = {}): Promise<SessionInfo> {
    const id = newId("session");
    const driver = this.driverFactory();
    const handle = await driver.create({
      title: input.title,
      model: input.model,
      thinkingLevel: input.thinkingLevel,
    });
    const mapping: DriverMapping = { driver, driverSessionId: handle.id };
    this.drivers.set(id, mapping);
    driver.subscribe(handle.id, (event) => this.handleDriverEvent(id, event));

    const now = nowIso();
    const record = {
      id,
      workspaceId: null,
      title: input.title ?? "New session",
      status: handle.status as SessionStatus,
      model: handle.model,
      thinkingLevel: handle.thinkingLevel,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };
    this.db.insert(schema.sessions).values(record).run();

    const info: SessionInfo = {
      id,
      workspaceId: null,
      title: record.title,
      status: record.status,
      model: record.model ?? undefined,
      thinkingLevel: record.thinkingLevel ?? undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastActivityAt: record.lastActivityAt ?? undefined,
    };
    this.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sessionCreated,
      payload: { sessionId: id, session: info },
    });
    this.logger.info({ sessionId: id }, "session created");
    return info;
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const mapping = this.require(sessionId);
    await mapping.driver.prompt(mapping.driverSessionId, { text });
    this.db
      .update(schema.sessions)
      .set({ updatedAt: nowIso(), lastActivityAt: nowIso() })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  async abort(sessionId: string): Promise<void> {
    const mapping = this.require(sessionId);
    await mapping.driver.abort(mapping.driverSessionId);
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    const mapping = this.require(sessionId);
    await mapping.driver.setModel(mapping.driverSessionId, { id: model });
    this.db
      .update(schema.sessions)
      .set({ model, updatedAt: nowIso() })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  list(): SessionInfo[] {
    const rows = this.db
      .select()
      .from(schema.sessions)
      .where(isNull(schema.sessions.workspaceId))
      .orderBy(desc(schema.sessions.createdAt))
      .all();
    return rows.map(toSessionInfo);
  }

  get(sessionId: string): SessionInfo | null {
    const row = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    return row ? toSessionInfo(row) : null;
  }

  usage(sessionId: string): UsageInfo | undefined {
    return this.drivers.get(sessionId)?.usage;
  }

  sessionCount(): number {
    return this.db.select().from(schema.sessions).all().length;
  }

  /* ------------------------------------------------------------------ */

  private require(sessionId: string): DriverMapping {
    const mapping = this.drivers.get(sessionId);
    if (!mapping) throw new Error(`Unknown session ${sessionId}`);
    return mapping;
  }

  private handleDriverEvent(sessionId: string, event: PiDriverEvent): void {
    const mapping = this.drivers.get(sessionId);
    if (!mapping) return;
    if (event.type === "usage.updated") mapping.usage = event.usage;

    this.hub.publish(this.toEnvelope(sessionId, event));

    // Persist state transitions (not every streaming event — DB writes stay rare).
    if (event.type === "state") {
      this.db
        .update(schema.sessions)
        .set({ status: event.status, updatedAt: nowIso(), lastActivityAt: nowIso() })
        .where(eq(schema.sessions.id, sessionId))
        .run();
    } else if (event.type === "error") {
      this.db
        .update(schema.sessions)
        .set({ status: "error", updatedAt: nowIso() })
        .where(eq(schema.sessions.id, sessionId))
        .run();
    } else if (event.type === "closed") {
      this.db
        .update(schema.sessions)
        .set({ status: "stopped", updatedAt: nowIso() })
        .where(eq(schema.sessions.id, sessionId))
        .run();
    }

    // Event checkpoint for reconnect (plan §26).
    const checkpoint = this.checkpoints.get(sessionId) ?? 0;
    this.checkpoints.set(sessionId, checkpoint + 1);
    if ((checkpoint + 1) % 20 === 0) {
      this.persistCheckpoint(sessionId);
    }
  }

  private toEnvelope(sessionId: string, event: PiDriverEvent): EventEnvelopeInit {
    const base = { scope: "session" as const, sessionId };
    switch (event.type) {
      case "user.message":
        return {
          ...base,
          type: EVENT_TYPES.userMessage,
          payload: {
            sessionId,
            messageId: event.messageId,
            content: event.content,
            createdAt: event.createdAt,
          },
        };
      case "assistant.start":
      case "assistant.end":
        return {
          ...base,
          type: event.type,
          payload: { sessionId, messageId: event.messageId },
        };
      case "assistant.delta":
      case "thinking.delta":
        return {
          ...base,
          type: event.type,
          payload: { sessionId, messageId: event.messageId, content: event.text },
        };
      case "thinking.start":
      case "thinking.end":
        return {
          ...base,
          type: event.type,
          payload: { sessionId, messageId: event.messageId },
        };
      case "tool.start":
        return {
          ...base,
          type: EVENT_TYPES.toolStart,
          payload: { sessionId, toolCallId: event.toolCallId, name: event.name, input: event.input },
        };
      case "tool.update":
        return {
          ...base,
          type: EVENT_TYPES.toolUpdate,
          payload: { sessionId, toolCallId: event.toolCallId, output: event.output },
        };
      case "tool.end":
        return {
          ...base,
          type: EVENT_TYPES.toolEnd,
          payload: {
            sessionId,
            toolCallId: event.toolCallId,
            output: event.output,
            durationMs: event.durationMs,
          },
        };
      case "tool.error":
        return {
          ...base,
          type: EVENT_TYPES.toolError,
          payload: { sessionId, toolCallId: event.toolCallId, error: event.error },
        };
      case "state":
        return {
          ...base,
          type: EVENT_TYPES.sessionState,
          payload: { sessionId, status: event.status },
        };
      case "model.updated":
        return { ...base, type: EVENT_TYPES.modelUpdated, payload: { sessionId, model: event.model } };
      case "usage.updated":
        return { ...base, type: EVENT_TYPES.usageUpdated, payload: { sessionId, usage: event.usage } };
      case "error":
        return { ...base, type: EVENT_TYPES.sessionError, payload: { sessionId, message: event.message } };
      case "closed":
        return { ...base, type: EVENT_TYPES.sessionClosed, payload: { sessionId, reason: event.reason } };
    }
  }

  private persistCheckpoint(sessionId: string): void {
    const seq = this.hub.currentSeq();
    this.db
      .insert(schema.eventCheckpoints)
      .values({ scope: "session", scopeId: sessionId, lastSeq: seq, updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: [schema.eventCheckpoints.scope, schema.eventCheckpoints.scopeId],
        set: { lastSeq: seq, updatedAt: nowIso() },
      })
      .run();
  }
}

function toSessionInfo(row: {
  id: string;
  workspaceId: string | null;
  title: string;
  status: string;
  model: string | null;
  thinkingLevel: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
}): SessionInfo {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    status: row.status as SessionStatus,
    model: row.model ?? undefined,
    thinkingLevel: row.thinkingLevel ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt ?? undefined,
  };
}
