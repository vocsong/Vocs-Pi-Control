/**
 * RealtimeHub — sequence assignment, bounded replay buffer, socket fan-out.
 *
 * Implements plan §25/§26: one global monotonically increasing sequence,
 * bounded in-memory replay (REPLAY_BUFFER_LIMIT), and idempotent commands.
 */

import {
  EVENT_TYPES,
  PROTOCOL_VERSION,
  REPLAY_BUFFER_LIMIT,
  type CommandAckPayload,
  type CommandErrorPayload,
  type EventEnvelope,
  type EventEnvelopeInit,
} from "@pi-control/protocol";
import type { Logger } from "../logger.js";

/** Minimal socket surface so the hub is testable without a real WebSocket. */
export interface SocketLike {
  send(data: string): void;
  readonly readyState?: number;
}

export class RealtimeHub {
  private seq = 0;
  private readonly buffer: EventEnvelope[] = [];
  private readonly sockets = new Map<SocketLike, Set<string>>();
  private readonly recentCommands = new Map<string, number>();
  private readonly commandTtlMs = 60_000;
  private readonly maxCommands = 10_000;

  constructor(private readonly logger: Logger) {}

  currentSeq(): number {
    return this.seq;
  }

  /** Attach a socket; returns a detach function. */
  attach(socket: SocketLike): () => void {
    this.sockets.set(socket, new Set());
    return () => {
      this.sockets.delete(socket);
    };
  }

  subscribe(socket: SocketLike, sessionId: string): void {
    this.sockets.get(socket)?.add(sessionId);
  }

  unsubscribe(socket: SocketLike, sessionId: string): void {
    this.sockets.get(socket)?.delete(sessionId);
  }

  /**
   * Remember a command id for idempotency. Returns false when the same id
   * was already processed within the TTL window.
   */
  rememberCommand(id: string): boolean {
    const now = Date.now();
    const previous = this.recentCommands.get(id);
    if (previous !== undefined && now - previous < this.commandTtlMs) {
      return false;
    }
    this.recentCommands.set(id, now);
    if (this.recentCommands.size > this.maxCommands) {
      const oldest = this.recentCommands.keys().next().value as string | undefined;
      if (oldest) this.recentCommands.delete(oldest);
    }
    return true;
  }

  /** Assign a sequence number, buffer, and broadcast. */
  publish(init: EventEnvelopeInit): EventEnvelope {
    const envelope = this.makeEnvelope(init);
    this.buffer.push(envelope);
    if (this.buffer.length > REPLAY_BUFFER_LIMIT) {
      this.buffer.splice(0, this.buffer.length - REPLAY_BUFFER_LIMIT);
    }
    for (const socket of this.sockets.keys()) {
      this.deliver(socket, envelope);
    }
    return envelope;
  }

  /**
   * Send one envelope to a single socket WITHOUT buffering or broadcasting.
   * Used for request/response envelopes (command acks, replay markers) which
   * must not re-enter the replay stream.
   */
  sendTo(socket: SocketLike, init: EventEnvelopeInit): EventEnvelope {
    const envelope = this.makeEnvelope(init);
    this.deliver(socket, envelope);
    return envelope;
  }

  /** Send one buffered envelope to a specific socket (replay path). */
  send(socket: SocketLike, envelope: EventEnvelope): void {
    this.deliver(socket, envelope);
  }

  /** Envelopes after `afterSeq` that this socket is entitled to see. */
  replayFor(socket: SocketLike, afterSeq: number): EventEnvelope[] {
    const subs = this.sockets.get(socket) ?? new Set<string>();
    return this.buffer.filter(
      (env) => env.seq > afterSeq && (env.scope !== "session" || subs.has(env.sessionId ?? "")),
    );
  }

  ack(socket: SocketLike, commandId: string, payload: Record<string, unknown> = {}): EventEnvelope {
    const ackPayload: CommandAckPayload = { commandId, lastSeq: this.seq, ...payload };
    return this.sendTo(socket, { scope: "server", type: EVENT_TYPES.commandAck, payload: ackPayload });
  }

  commandError(socket: SocketLike, commandId: string, message: string): EventEnvelope {
    const payload: CommandErrorPayload = { commandId, message };
    return this.sendTo(socket, { scope: "server", type: EVENT_TYPES.commandError, payload });
  }

  duplicate(socket: SocketLike, commandId: string): EventEnvelope {
    return this.sendTo(socket, {
      scope: "server",
      type: EVENT_TYPES.commandDuplicate,
      payload: { commandId },
    });
  }

  private makeEnvelope(init: EventEnvelopeInit): EventEnvelope {
    return {
      version: PROTOCOL_VERSION,
      seq: ++this.seq,
      timestamp: Date.now(),
      ...init,
    };
  }

  private deliver(socket: SocketLike, envelope: EventEnvelope): void {
    if (envelope.scope === "session") {
      const subs = this.sockets.get(socket);
      if (!subs?.has(envelope.sessionId ?? "")) return;
    }
    try {
      socket.send(JSON.stringify(envelope));
    } catch (error) {
      this.logger.warn({ error: String(error) }, "socket send failed; detaching");
      this.sockets.delete(socket);
    }
  }
}
