/**
 * WorkspaceSessionManager — Pi sessions that run INSIDE a workspace sandbox
 * via the workspace agent (real Pi SDK, Phase 3).
 *
 * The control server generates the browser-facing session id, persists the
 * control-plane record, and forwards commands to the agent. Driver events
 * arrive back as `agent.session.event` (already normalized envelope inits)
 * and are published to browsers by the AgentManager.
 */

import { schema, type Db } from "@pi-control/database";
import { desc, eq, isNotNull, isNull } from "drizzle-orm";
import { EVENT_TYPES, type SessionInfo, type SessionStatus } from "@pi-control/protocol";
import { newId, nowIso } from "@pi-control/shared";
import type { AgentManager } from "../agents/agentManager.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { Logger } from "../logger.js";

export interface CreateWorkspaceSessionInput {
  title?: string;
  model?: string;
  thinkingLevel?: string;
}

export class WorkspaceSessionManager {
  constructor(
    private readonly db: Db,
    private readonly agents: AgentManager,
    private readonly hub: RealtimeHub,
    private readonly logger: Logger,
  ) {}

  async create(workspaceId: string, input: CreateWorkspaceSessionInput = {}): Promise<SessionInfo> {
    const sessionId = newId("session");
    const now = nowIso();
    const title = input.title ?? "New session";

    this.db
      .insert(schema.sessions)
      .values({
        id: sessionId,
        workspaceId,
        title,
        status: "starting",
        model: input.model ?? null,
        thinkingLevel: input.thinkingLevel ?? null,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      })
      .run();

    const created = await this.agents.createSession(workspaceId, {
      sessionId,
      title,
      model: input.model,
      thinkingLevel: input.thinkingLevel,
    });

    const nativePiSessionId = (created.nativePiSessionId as string | undefined) ?? null;
    this.db
      .update(schema.sessions)
      .set({
        nativePiSessionId,
        status: "idle",
        model: (created.model as string | undefined) ?? input.model ?? null,
        thinkingLevel: (created.thinkingLevel as string | undefined) ?? input.thinkingLevel ?? null,
        updatedAt: nowIso(),
      })
      .where(eq(schema.sessions.id, sessionId))
      .run();

    const info = this.get(sessionId);
    if (!info) throw new Error("session record lost after creation");

    this.hub.publish({
      scope: "server",
      type: EVENT_TYPES.sessionCreated,
      payload: { sessionId, session: info },
    });
    this.logger.info({ sessionId, workspaceId, nativePiSessionId }, "workspace pi session created");
    return info;
  }

  async resume(workspaceId: string, nativeSessionPath: string, input: CreateWorkspaceSessionInput = {}): Promise<SessionInfo> {
    const sessionId = newId("session");
    const now = nowIso();
    const title = input.title ?? "Resumed session";

    this.db
      .insert(schema.sessions)
      .values({
        id: sessionId,
        workspaceId,
        title,
        status: "starting",
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      })
      .run();

    const created = await this.agents.resumeSession(workspaceId, sessionId, nativeSessionPath);
    this.db
      .update(schema.sessions)
      .set({
        nativePiSessionId: (created.nativePiSessionId as string | undefined) ?? null,
        nativePiSessionPath: nativeSessionPath,
        status: "idle",
        updatedAt: nowIso(),
      })
      .where(eq(schema.sessions.id, sessionId))
      .run();

    const info = this.get(sessionId);
    if (!info) throw new Error("session record lost after resume");
    this.hub.publish({ scope: "server", type: EVENT_TYPES.sessionCreated, payload: { sessionId, session: info } });
    return info;
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const { workspaceId } = this.require(sessionId);
    // The embedded driver does not re-emit the user message; publish it
    // server-side (same semantics as the mock path).
    this.hub.publish({
      scope: "session",
      sessionId,
      type: EVENT_TYPES.userMessage,
      payload: { sessionId, messageId: newId("msg"), content: text, createdAt: nowIso() },
    });
    await this.agents.promptSession(workspaceId, sessionId, text);
    this.db
      .update(schema.sessions)
      .set({ updatedAt: nowIso(), lastActivityAt: nowIso() })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  async steer(sessionId: string, text: string): Promise<void> {
    const { workspaceId } = this.require(sessionId);
    await this.agents.steerSession(workspaceId, sessionId, text);
  }

  async followUp(sessionId: string, text: string): Promise<void> {
    const { workspaceId } = this.require(sessionId);
    await this.agents.followUpSession(workspaceId, sessionId, text);
  }

  async abort(sessionId: string): Promise<void> {
    const { workspaceId } = this.require(sessionId);
    await this.agents.abortSession(workspaceId, sessionId);
  }

  async compact(sessionId: string): Promise<void> {
    const { workspaceId } = this.require(sessionId);
    await this.agents.compactSession(workspaceId, sessionId);
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    const { workspaceId } = this.require(sessionId);
    await this.agents.setSessionModel(workspaceId, sessionId, model);
    this.db.update(schema.sessions).set({ model, updatedAt: nowIso() }).where(eq(schema.sessions.id, sessionId)).run();
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    const { workspaceId } = this.require(sessionId);
    await this.agents.setSessionThinkingLevel(workspaceId, sessionId, level);
    this.db
      .update(schema.sessions)
      .set({ thinkingLevel: level, updatedAt: nowIso() })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  list(workspaceId?: string): SessionInfo[] {
    const rows = workspaceId
      ? this.db.select().from(schema.sessions).where(eq(schema.sessions.workspaceId, workspaceId)).orderBy(desc(schema.sessions.createdAt)).all()
      : this.db.select().from(schema.sessions).where(isNotNull(schema.sessions.workspaceId)).orderBy(desc(schema.sessions.createdAt)).all();
    return rows.map(toSessionInfo);
  }

  get(sessionId: string): SessionInfo | null {
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
    if (!row || !row.workspaceId) return null;
    return toSessionInfo(row);
  }

  owns(sessionId: string): boolean {
    return this.get(sessionId) !== null;
  }

  /* ------------------------------------------------------------------ */

  private require(sessionId: string): { workspaceId: string } {
    const info = this.get(sessionId);
    if (!info?.workspaceId) throw new Error(`Unknown workspace session ${sessionId}`);
    return { workspaceId: info.workspaceId };
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
