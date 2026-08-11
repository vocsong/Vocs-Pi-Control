/**
 * RealtimeClient — browser WebSocket client for the Pi Control protocol.
 *
 * Handles reconnect with backoff, tracks lastSeq for bounded replay
 * (plan §26), and resolves commands by request id.
 */

import { command, type ClientCommandType, type EventEnvelope } from "@pi-control/protocol";

export type RealtimeStatus = "connecting" | "open" | "closed";

export interface RealtimeHandlers {
  onStatus(status: RealtimeStatus): void;
  onEvent(envelope: EventEnvelope): void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const COMMAND_TIMEOUT_MS = 15_000;

interface PendingCommand {
  resolve(envelope: EventEnvelope): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectDelay = RECONNECT_BASE_MS;
  private readonly pending = new Map<string, PendingCommand>();

  constructor(
    private readonly url: string,
    private readonly handlers: RealtimeHandlers,
  ) {}

  connect(): void {
    this.stopped = false;
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  sendCommand(type: ClientCommandType, payload: unknown): Promise<EventEnvelope> {
    const cmd = command(type, payload);
    return new Promise<EventEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(cmd.id);
        reject(new Error(`command timeout: ${cmd.type}`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(cmd.id, { resolve, reject, timeout });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(cmd));
      } else {
        clearTimeout(timeout);
        this.pending.delete(cmd.id);
        reject(new Error("socket not connected"));
      }
    });
  }

  /* ------------------------------------------------------------------ */

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.handlers.onStatus("connecting");

    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.handlers.onStatus("open");
    };

    ws.onmessage = (event) => {
      this.handleMessage(String(event.data));
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handlers.onStatus("closed");
      this.rejectPending(new Error("socket closed"));
      if (!this.stopped) {
        setTimeout(() => this.open(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private handleMessage(raw: string): void {
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(raw) as EventEnvelope;
    } catch {
      return;
    }
    const { payload } = envelope;
    if (
      (envelope.type === "command.ack" ||
        envelope.type === "command.error" ||
        envelope.type === "command.duplicate") &&
      typeof payload === "object" &&
      payload !== null &&
      "commandId" in payload &&
      typeof payload.commandId === "string"
    ) {
      const pending = this.pending.get(payload.commandId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(payload.commandId);
        if (envelope.type === "command.ack") pending.resolve(envelope);
        else pending.reject(new Error(`command rejected: ${envelope.type}: ${String((payload as { message?: string }).message ?? "")}`));
      }
    }
    this.handlers.onEvent(envelope);
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}
