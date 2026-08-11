/**
 * WebSocket endpoint — single browser connection multiplexing session
 * subscriptions (plan §25). Mutations arrive as ClientCommands with request
 * ids; responses and events are EventEnvelopes.
 *
 * Phase 4 additions: authoritative snapshots when bounded replay cannot
 * satisfy a reconnect gap (plan §26.1), and the browser editing lease
 * (plan §27).
 */

import fastifyWebsocket from "@fastify/websocket";
import { z } from "zod";
import {
  CLIENT_COMMAND_TYPES,
  EVENT_TYPES,
  type ClientCommand,
  type LeaseInfo,
} from "@pi-control/protocol";
import { newId } from "@pi-control/shared";
import type { RealtimeHub, SocketLike } from "./hub.js";
import type { SessionManager } from "../sessions/manager.js";
import type { WorkspaceSessionManager } from "../sessions/workspaceSessions.js";
import type { AgentManager } from "../agents/agentManager.js";
import type { Logger } from "../logger.js";
import type { AppFastify } from "../types.js";
import { LeaseManager } from "./leases.js";

export interface RealtimeDeps {
  hub: RealtimeHub;
  sessions: SessionManager;
  workspaceSessions: WorkspaceSessionManager;
  agents: AgentManager;
  leases: LeaseManager;
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

const leaseSchema = z.object({ sessionId: z.string().min(1).max(128) }).strict();

const leaseTakeSchema = z
  .object({ sessionId: z.string().min(1).max(128), force: z.boolean().optional() })
  .strict();

export function registerRealtime(app: AppFastify, deps: RealtimeDeps): void {
  app.get("/ws", { websocket: true }, (socket) => {
    const clientId = newId("client");
    const detach = deps.hub.attach(socket as unknown as SocketLike);
    socket.on("close", () => {
      detach();
      // Release any editing leases held by this client.
      const released = deps.leases.releaseAllFor(clientId);
      for (const sessionId of released) {
        deps.hub.publish({
          scope: "session",
          sessionId,
          type: EVENT_TYPES.sessionLease,
          payload: { sessionId, holder: null, expiresAt: null } satisfies LeaseInfo,
        });
      }
    });
    socket.on("error", detach);
    socket.on("message", (raw) => {
      void handleMessage(socket as unknown as SocketLike, clientId, String(raw), deps);
    });

    // Announce the client id so lease holders can be compared client-side.
    deps.hub.sendTo(socket as unknown as SocketLike, {
      scope: "server",
      type: EVENT_TYPES.serverHello,
      payload: { clientId },
    });
  });
}

async function handleMessage(socket: SocketLike, clientId: string, raw: string, deps: RealtimeDeps): Promise<void> {
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
    await execute(command, socket, clientId, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn({ commandId: command.id, commandType: command.type, error: message }, "command failed");
    deps.hub.commandError(socket, command.id, message);
  }
}

async function execute(command: ClientCommand, socket: SocketLike, clientId: string, deps: RealtimeDeps): Promise<void> {
  const { hub, sessions, workspaceSessions, leases } = deps;
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
      // Editing lease: when enforcement is on, only the lease holder prompts.
      const { allowed, lease } = leases.mayPrompt(payload.sessionId, clientId);
      if (!allowed) {
        hub.commandError(
          socket,
          command.id,
          `lease_held: another client (${lease.holder}) holds the editing lease for this session`,
        );
        return;
      }
      if (workspaceSessions.owns(payload.sessionId)) {
        await workspaceSessions.prompt(payload.sessionId, payload.text);
      } else {
        await sessions.prompt(payload.sessionId, payload.text);
      }
      hub.ack(socket, command.id);
      return;
    }
    case "session.abort": {
      const payload = sessionIdSchema.parse(command.payload);
      if (workspaceSessions.owns(payload.sessionId)) {
        await workspaceSessions.abort(payload.sessionId);
      } else {
        await sessions.abort(payload.sessionId);
      }
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
    case "session.lease.take": {
      const payload = leaseTakeSchema.parse(command.payload);
      const lease = leases.take(payload.sessionId, clientId, payload.force);
      hub.publish({
        scope: "session",
        sessionId: payload.sessionId,
        type: EVENT_TYPES.sessionLease,
        payload: lease,
      });
      hub.ack(socket, command.id);
      return;
    }
    case "session.lease.release": {
      const payload = leaseSchema.parse(command.payload);
      const lease = leases.release(payload.sessionId, clientId);
      hub.publish({
        scope: "session",
        sessionId: payload.sessionId,
        type: EVENT_TYPES.sessionLease,
        payload: lease,
      });
      hub.ack(socket, command.id);
      return;
    }
    case "session.lease.heartbeat": {
      const payload = leaseSchema.parse(command.payload);
      const lease = leases.heartbeat(payload.sessionId, clientId);
      hub.publish({
        scope: "session",
        sessionId: payload.sessionId,
        type: EVENT_TYPES.sessionLease,
        payload: lease,
      });
      hub.ack(socket, command.id);
      return;
    }
    case "terminal.open": {
      const payload = z.object({ workspaceId: z.string(), cols: z.number().optional(), rows: z.number().optional() }).parse(command.payload);
      const terminalId = `term_${crypto.randomUUID()}`;
      const terminal = await deps.agents.openTerminal(payload.workspaceId, terminalId, payload.cols ?? 80, payload.rows ?? 24);
      hub.ack(socket, command.id, { terminalId, terminal });
      return;
    }
    case "terminal.input": {
      const payload = z
        .object({ workspaceId: z.string(), terminalId: z.string(), data: z.string().max(64 * 1024) })
        .parse(command.payload);
      await deps.agents.terminalInput(payload.workspaceId, payload.terminalId, payload.data);
      hub.ack(socket, command.id);
      return;
    }
    case "terminal.resize": {
      const payload = z
        .object({ workspaceId: z.string(), terminalId: z.string(), cols: z.number(), rows: z.number() })
        .parse(command.payload);
      await deps.agents.terminalResize(payload.workspaceId, payload.terminalId, payload.cols, payload.rows);
      hub.ack(socket, command.id);
      return;
    }
    case "terminal.close": {
      const payload = z.object({ workspaceId: z.string(), terminalId: z.string() }).parse(command.payload);
      await deps.agents.closeTerminal(payload.workspaceId, payload.terminalId);
      hub.ack(socket, command.id);
      return;
    }
  }
}

/** Deliver buffered events after `lastSeq`, then a replay.complete marker. */
function replay(socket: SocketLike, lastSeq: number, deps: RealtimeDeps): void {
  const { envelopes, gap } = deps.hub.replayFor(socket, lastSeq);
  if (gap) {
    // Bounded replay cannot satisfy the gap (server restart or a very old
    // lastSeq): send an authoritative snapshot instead (plan §26.1).
    const subscribed = deps.hub.subscribedSessions(socket);
    for (const sessionId of subscribed) {
      const session = deps.sessions.get(sessionId) ?? deps.workspaceSessions.get(sessionId);
      if (session) {
        deps.hub.sendTo(socket, {
          scope: "session",
          sessionId,
          type: EVENT_TYPES.sessionSnapshot,
          payload: { sessionId, session, reason: "replay_gap" },
        });
      }
    }
  } else {
    for (const envelope of envelopes) {
      deps.hub.send(socket, envelope);
    }
  }
  deps.hub.sendTo(socket, {
    scope: "server",
    type: EVENT_TYPES.replayComplete,
    payload: { lastSeq: deps.hub.currentSeq() },
  });
}
