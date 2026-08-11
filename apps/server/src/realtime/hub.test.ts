import { describe, expect, it, vi } from "vitest";
import { RealtimeHub, type SocketLike } from "./hub.js";
import { createLogger } from "../logger.js";
import { EVENT_TYPES } from "@pi-control/protocol";

function makeSocket(): SocketLike & { received: string[] } {
  return {
    received: [],
    send(data: string) {
      this.received.push(data);
    },
  };
}

const logger = createLogger("silent");

describe("RealtimeHub", () => {
  it("assigns monotonically increasing sequence numbers", () => {
    const hub = new RealtimeHub(logger);
    const a = hub.publish({ scope: "server", type: "test.a", payload: {} });
    const b = hub.publish({ scope: "server", type: "test.b", payload: {} });
    expect(b.seq).toBe(a.seq + 1);
  });

  it("broadcasts server-scoped events to all sockets", () => {
    const hub = new RealtimeHub(logger);
    const s1 = makeSocket();
    const s2 = makeSocket();
    hub.attach(s1);
    hub.attach(s2);
    hub.publish({ scope: "server", type: "test.x", payload: { n: 1 } });
    expect(s1.received).toHaveLength(1);
    expect(s2.received).toHaveLength(1);
  });

  it("delivers session events only to subscribed sockets", () => {
    const hub = new RealtimeHub(logger);
    const subscribed = makeSocket();
    const other = makeSocket();
    hub.attach(subscribed);
    hub.attach(other);
    hub.subscribe(subscribed, "session_1");
    hub.publish({ scope: "session", sessionId: "session_1", type: "session.state", payload: {} });
    hub.publish({ scope: "server", type: "session.created", payload: {} });
    expect(subscribed.received).toHaveLength(2);
    expect(other.received).toHaveLength(1);
  });

  it("replays buffered events after lastSeq for subscribed scopes", () => {
    const hub = new RealtimeHub(logger);
    const socket = makeSocket();
    hub.attach(socket);
    hub.subscribe(socket, "session_1");
    const env1 = hub.publish({ scope: "session", sessionId: "session_1", type: "a", payload: {} });
    hub.publish({ scope: "session", sessionId: "session_2", type: "b", payload: {} });
    const env3 = hub.publish({ scope: "server", type: "c", payload: {} });

    const replay = hub.replayFor(socket, env1.seq);
    expect(replay.map((e) => e.type)).toEqual(["c"]);
    void env3;
  });

  it("deduplicates command ids within the TTL window", () => {
    const hub = new RealtimeHub(logger);
    expect(hub.rememberCommand("cmd_1")).toBe(true);
    expect(hub.rememberCommand("cmd_1")).toBe(false);
    expect(hub.rememberCommand("cmd_2")).toBe(true);
  });

  it("acknowledges commands with the current seq", () => {
    const hub = new RealtimeHub(logger);
    const socket = makeSocket();
    hub.attach(socket);
    const ack = hub.ack(socket, "cmd_x", { sessionId: "session_1" });
    expect(ack.type).toBe(EVENT_TYPES.commandAck);
    expect(ack.payload).toMatchObject({ commandId: "cmd_x", sessionId: "session_1" });
  });

  it("detaches sockets on send failure", () => {
    const hub = new RealtimeHub(logger);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const broken: SocketLike = {
      send() {
        throw new Error("closed");
      },
    };
    hub.attach(broken);
    hub.publish({ scope: "server", type: "x", payload: {} });
    expect(warn).toHaveBeenCalled();
  });
});
