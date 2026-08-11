/**
 * WebSocket endpoint — single browser connection multiplexing session
 * subscriptions (plan §25). Mutations arrive as ClientCommands with request
 * ids; responses and events are EventEnvelopes.
 */

import fastifyWebsocket from "@fastify/websocket";
import { z } from "zod";
import { CLIENT_COMMAND_TYPES, EVENT_TYPES, type ClientCommand } from "@pi-control/protocol";
import type { RealtimeHub, SocketLike } from "./hub.js";
import type { SessionManager } from "../sessions/manager.js";
import type { Logger } from "../logger.js";
import type { AppFastify } from "../types.js";

export interface RealtimeDeps {
  hub: RealtimeHub;
  sessions: SessionManager;
  logger: Logger;
}

const commandSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(CLIENT_COMMAND_TYPES),
  payload: z.unknown(),
});

const createSessionSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    model: z.string().min(1).max(200).optional(),
    thinkingLevel: z.string().min(1).max(50).optional(),
  })
  .strict();

const promptSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    text: z.string().min(1).max(100_000),
  })
  .strict();

const sessionIdSchema = z.object({ sessionId: z.string().min(1).max(128) }).strict();

const subscribeSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    lastSeq: z.number().int().min(0),
  })
  .strict();

const replaySchema = z.object({ lastSeq: z.number().int().min(0) }).strict();

export function registerRealtime(app: AppFastify, deps: RealtimeDeps): void {
  app.get("/ws", { websocket: true }, (socket) => {
    const detach = deps.hub.attach(socket as unknown as SocketLike);
    socket.on("close", detach);
    socket.on("error", detach);
    socket.on("message", (raw) => {
      void handleMessage(socket as unknown as SocketLike, String(raw), deps);
    });
  });
}

async function handleMessage(socket: SocketLike, raw: string, deps: RealtimeDeps): Promise<void> {
  const parsed = commandSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    deps.hub.commandError(socket, "?", `invalid command: ${parsed.error.issues[0]?.message ?? "parse error"}`);
    return;
  }
  const command = parsed.data as ClientCommand;

  // Idempotency: duplicate request ids (e.g. after reconnect) are rejected.
  if (!deps.hub.rememberCommand(command.id)) {
    deps.hub.duplicate(socket, command.id);
    return;
  }

  try {
    await execute(command, socket, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn({ commandId: command.id, commandType: command.type, error: message }, "command failed");
    deps.hub.commandError(socket, command.id, message);
  }
}

async function execute(command: ClientCommand, socket: SocketLike, deps: RealtimeDeps): Promise<void> {
  const { hub, sessions } = deps;
  switch (command.type) {
    case "health.ping": {
      hub.ack(socket, command.id);
      return;
    }
    case "session.create": {
      const input = createSessionSchema.parse(command.payload);
      const session = await sessions.createSession(input);
      hub.ack(socket, command.id, { sessionId: session.id });
      return;
    }
    case "session.prompt": {
      const payload = promptSchema.parse(command.payload);
      await sessions.prompt(payload.sessionId, payload.text);
      hub.ack(socket, command.id);
      return;
    }
    case "session.abort": {
      const payload = sessionIdSchema.parse(command.payload);
      await sessions.abort(payload.sessionId);
      hub.ack(socket, command.id);
      return;
    }
    case "session.subscribe": {
      const payload = subscribeSchema.parse(command.payload);
      hub.subscribe(socket, payload.sessionId);
      replay(socket, payload.lastSeq, deps);
      hub.ack(socket, command.id, { sessionId: payload.sessionId });
      return;
    }
    case "session.unsubscribe": {
      const payload = sessionIdSchema.parse(command.payload);
      hub.unsubscribe(socket, payload.sessionId);
      hub.ack(socket, command.id);
      return;
    }
    case "session.replay": {
      const payload = replaySchema.parse(command.payload);
      replay(socket, payload.lastSeq, deps);
      hub.ack(socket, command.id);
      return;
    }
  }
}

/** Deliver buffered events after `lastSeq`, then a replay.complete marker. */
function replay(socket: SocketLike, lastSeq: number, deps: RealtimeDeps): void {
  const envelopes = deps.hub.replayFor(socket, lastSeq);
  for (const envelope of envelopes) {
    deps.hub.send(socket, envelope);
  }
  deps.hub.sendTo(socket, {
    scope: "server",
    type: EVENT_TYPES.replayComplete,
    payload: { lastSeq: deps.hub.currentSeq() },
  });
}
