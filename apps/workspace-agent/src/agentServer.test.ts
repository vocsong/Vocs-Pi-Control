import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { startAgentServer, type AgentServerHandle } from "./agentServer.js";
import type { AgentConfig } from "./config.js";
import { waitFor } from "@pi-control/test-utils";

const CONFIG: AgentConfig = {
  host: "127.0.0.1",
  port: 4199,
  token: "test-token-123",
  workspaceId: "ws_test",
  agentVersion: "0.0.0-test",
};

let handle: AgentServerHandle;
let baseUrl: string;

beforeAll(async () => {
  handle = await startAgentServer({ config: CONFIG, logger: () => undefined });
  baseUrl = `ws://127.0.0.1:${CONFIG.port}`;
});

afterAll(async () => {
  await handle.close();
});

function connect(token?: string): Promise<WebSocket & { messages: Array<{ type: string; payload: any; id?: string }> }> {
  const ws = new WebSocket(`${baseUrl}`, {
    headers: { authorization: token === undefined ? `Bearer ${CONFIG.token}` : `Bearer ${token}` },
  }) as WebSocket & { messages: Array<{ type: string; payload: any; id?: string }> };
  ws.messages = [];
  ws.on("message", (raw) => {
    const parsed = JSON.parse(String(raw));
    if (parsed.type === "agent.exec.exit" || parsed.type === "agent.error") {
      ws.messages.push({ ...parsed, id: parsed.payload?.commandId });
    } else {
      ws.messages.push(parsed);
    }
  });
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function send<T>(ws: WebSocket, type: string, payload: T, id = Math.random().toString(36).slice(2)): string {
  ws.send(JSON.stringify({ id, type, payload }));
  return id;
}

/** Collect events (from connection time) until the predicate matches. */
async function collect(
  ws: WebSocket & { messages: Array<{ type: string; payload: any; id?: string }> },
  predicate: (events: { type: string; payload: unknown; id?: string }[]) => boolean,
  timeoutMs = 5000,
): Promise<{ type: string; payload: any; id?: string }[]> {
  await waitFor(() => (predicate(ws.messages) ? true : null), { timeoutMs, label: "agent events" });
  return ws.messages;
}

describe("workspace agent server", () => {
  it("rejects connections without a valid token", async () => {
    const ws = new WebSocket(baseUrl, { headers: { authorization: "Bearer wrong" } });
    const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
    const code = await closed;
    expect(code).toBe(4001);
  });

  it("accepts a valid token and sends agent.ready with workspace identity", async () => {
    const ws = await connect();
    const events = await collect(ws, (e) => e.some((x) => x.type === "agent.ready"));
    const ready = events.find((e) => e.type === "agent.ready");
    expect(ready?.payload).toMatchObject({ workspaceId: "ws_test", protocolVersion: 1, processes: [] });
    ws.close();
  });

  it("runs exec commands and streams output", async () => {
    const ws = await connect();
    send(ws, "agent.exec", {
      command: ["node", "-e", "console.log('hello from agent'); console.error('err'); process.exit(0)"],
      cwd: "/",
    });
    const events = await collect(ws, (e) => e.some((x) => x.type === "agent.exec.exit"));
    const outputs = events.filter((e) => e.type === "agent.exec.output");
    const exit = events.find((e) => e.type === "agent.exec.exit");
    expect(outputs.map((o) => o.payload.text).join("")).toContain("hello from agent");
    expect(outputs.map((o) => o.payload.text).join("")).toContain("err");
    expect(exit?.payload).toMatchObject({ exitCode: 0 });
    ws.close();
  });

  it("supervises long-running processes across reconnects", async () => {
    const ws1 = await connect();
    send(ws1, "agent.process.spawn", {
      name: "ticker",
      command: ["node", "-e", "setInterval(() => console.log('tick'), 200)"],
      cwd: "/",
    });
    const events1 = await collect(ws1, (e) => e.some((x) => x.type === "agent.process.started"));
    const started = events1.find((e) => e.type === "agent.process.started");
    const processId = started && (started.payload as { process: { id: string } }).process.id;
    expect(processId).toBeTruthy();

    // Output flows
    await collect(ws1, (e) => e.some((x) => x.type === "agent.process.output"));
    ws1.close();

    // Simulate control-server restart: a NEW connection sees the process alive.
    const ws2 = await connect();
    const events2 = await collect(ws2, (e) => e.some((x) => x.type === "agent.ready"));
    const ready = events2.find((e) => e.type === "agent.ready");
    expect(ready?.payload.processes.some((p: { id: string }) => p.id === processId)).toBe(true);

    // And output continues on the new connection.
    const events3 = await collect(ws2, (e) => e.some((x) => x.type === "agent.process.output"));
    expect(events3.some((e) => e.type === "agent.process.output")).toBe(true);

    // Kill it.
    send(ws2, "agent.process.kill", { processId });
    await collect(ws2, (e) =>
      e.some((x) => x.type === "agent.process.exited" && (x.payload as { processId: string }).processId === processId),
    );
    ws2.close();
  }, 15_000);

  it("answers ping with health", async () => {
    const ws = await connect();
    send(ws, "agent.ping", {});
    const events = await collect(ws, (e) => e.some((x) => x.type === "agent.health"));
    const health = events.find((e) => e.type === "agent.health");
    expect(health?.payload).toMatchObject({ workspaceId: "ws_test" });
    expect(health?.payload.memory).toBeTypeOf("object");
    ws.close();
  });
});
