/**
 * SessionSupervisor — owns Pi sessions inside the workspace agent
 * (plan §13). One driver instance backs many sessions; driver events are
 * normalized into protocol envelope inits and streamed to the control
 * server as `agent.session.event`.
 */

import { type AgentSessionInfo, type EventEnvelopeInit } from "@pi-control/protocol";
import {
  driverEventToEnvelope,
  type CreatePiSessionOptions,
  type PiDriverEvent,
  type PiSessionDriver,
} from "@pi-control/pi-driver";

interface ManagedSession {
  info: AgentSessionInfo;
  /** PiSessionHandle.id returned by the driver (NOT the native pi session id). */
  driverSessionId: string;
  unsubscribe: () => void;
}

export interface SessionSupervisorEvents {
  onEvent(sessionId: string, envelope: EventEnvelopeInit): void;
}

export class SessionSupervisor {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(
    private readonly driver: PiSessionDriver,
    private readonly events: SessionSupervisorEvents,
  ) {}

  async create(
    controlSessionId: string,
    options: CreatePiSessionOptions = {},
  ): Promise<AgentSessionInfo> {
    const handle = await this.driver.create({
      title: options.title,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
    });
    const info: AgentSessionInfo = {
      sessionId: controlSessionId,
      nativePiSessionId: handle.nativePiSessionId,
      sessionFile: handle.sessionFile,
      title: options.title ?? "New session",
      status: handle.status,
      model: handle.model,
      thinkingLevel: handle.thinkingLevel,
    };
    this.register(controlSessionId, info, handle.id);
    return { ...info };
  }

  async resume(controlSessionId: string, nativeSessionPath: string): Promise<AgentSessionInfo> {
    const handle = await this.driver.resume(nativeSessionPath);
    const info: AgentSessionInfo = {
      sessionId: controlSessionId,
      nativePiSessionId: handle.nativePiSessionId,
      nativePiSessionPath: nativeSessionPath,
      sessionFile: handle.sessionFile,
      title: "Resumed session",
      status: handle.status,
      model: handle.model,
      thinkingLevel: handle.thinkingLevel,
    };
    this.register(controlSessionId, info, handle.id);
    return { ...info };
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await this.driver.prompt(this.require(sessionId), { text });
  }

  async steer(sessionId: string, text: string): Promise<void> {
    await this.driver.steer(this.require(sessionId), { text });
  }

  async followUp(sessionId: string, text: string): Promise<void> {
    await this.driver.followUp(this.require(sessionId), { text });
  }

  async abort(sessionId: string): Promise<void> {
    await this.driver.abort(this.require(sessionId));
  }

  async compact(sessionId: string): Promise<void> {
    await this.driver.compact(this.require(sessionId));
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    await this.driver.setModel(this.require(sessionId), { id: model });
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    await this.driver.setThinkingLevel(this.require(sessionId), level);
  }

  async dispose(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    managed.unsubscribe();
    await this.driver.dispose(managed.driverSessionId);
    this.sessions.delete(sessionId);
  }

  list(): AgentSessionInfo[] {
    return [...this.sessions.values()].map((m) => ({ ...m.info }));
  }

  count(): number {
    return this.sessions.size;
  }

  /** Dispose everything (agent shutdown). */
  async shutdown(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      await this.dispose(sessionId);
    }
  }

  /* ------------------------------------------------------------------ */

  private register(controlSessionId: string, info: AgentSessionInfo, driverSessionId: string): void {
    const unsubscribe = this.driver.subscribe(driverSessionId, (event) => this.forward(controlSessionId, event));
    this.sessions.set(controlSessionId, { info, driverSessionId, unsubscribe });
  }

  private require(sessionId: string): string {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`Unknown session ${sessionId}`);
    return managed.driverSessionId;
  }

  private forward(sessionId: string, event: PiDriverEvent): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    if (event.type === "state") managed.info.status = event.status;
    if (event.type === "model.updated") managed.info.model = event.model;
    const envelope = driverEventToEnvelope(sessionId, event);
    this.events.onEvent(sessionId, envelope);
  }
}
