/* Phase 4 verification: editing lease (enforced) + authoritative snapshot. */
const URL_ = "ws://127.0.0.1:5174/ws";
let clientId = null;
let sessionId = null;
let ws2 = null;

function send(ws, type, payload, id) {
  ws.send(JSON.stringify({ id, type, payload }));
}

const ws1 = new WebSocket(URL_);
ws1.addEventListener("open", () => {
  console.log("[1] connected");
  send(ws1, "session.create", { title: "Phase 4 test" }, "c1");
});

ws1.addEventListener("message", (event) => {
  const env = JSON.parse(String(event.data));
  if (env.type === "server.hello") clientId = env.payload.clientId;
  if (env.type === "session.lease") {
    console.log("[1] lease:", env.payload.holder === clientId ? "self" : env.payload.holder ? "other" : "null");
  }
  if (env.type === "command.ack" && env.payload.commandId === "c1") {
    sessionId = env.payload.sessionId;
    console.log("[1] session:", sessionId.slice(0, 20), "| client:", clientId.slice(0, 14));
    send(ws1, "session.subscribe", { sessionId, lastSeq: 0 }, "s1");
    send(ws1, "session.lease.take", { sessionId }, "t1");
  }
  if (env.type === "command.ack" && env.payload.commandId === "t1") {
    console.log("[1] lease taken; second client joins");
    ws2 = new WebSocket(URL_);
    ws2.addEventListener("open", () => {
      send(ws2, "session.subscribe", { sessionId, lastSeq: 0 }, "s2");
      send(ws2, "session.lease.take", { sessionId }, "t2");
    });
    ws2.addEventListener("message", (e2) => {
      const env2 = JSON.parse(String(e2.data));
      if (env2.type === "command.ack" && env2.payload.commandId === "t2") {
        console.log("[2] take returned (holder unchanged); prompting");
        send(ws2, "session.prompt", { sessionId, text: "blocked?" }, "p2");
      }
      if (env2.type === "command.error" && env2.payload.commandId === "p2") {
        console.log("[2] prompt rejected:", env2.payload.message.slice(0, 60));
        send(ws1, "session.lease.release", { sessionId }, "r1");
      }
      if (env2.type === "command.ack" && env2.payload.commandId === "p2b") {
        console.log("[2] prompt accepted after release ✓");
        ws1.close();
        ws2.close();
        setTimeout(restartTest, 400);
      }
    });
  }
  if (env.type === "command.ack" && env.payload.commandId === "r1") {
    console.log("[2] lease released; prompting again");
    send(ws2, "session.prompt", { sessionId, text: "after release" }, "p2b");
  }
});

function restartTest() {
  console.log("\n=== reconnect with unsatisfiable lastSeq → authoritative snapshot ===");
  const ws3 = new WebSocket(URL_);
  ws3.addEventListener("open", () => {
    send(ws3, "session.subscribe", { sessionId, lastSeq: 999999 }, "sub3");
  });
  ws3.addEventListener("message", (e3) => {
    const env3 = JSON.parse(String(e3.data));
    if (env3.type === "session.snapshot") {
      console.log("snapshot ✓ reason:", env3.payload.reason, "| title:", env3.payload.session.title);
      process.exit(0);
    }
  });
}

setTimeout(() => {
  console.error("TIMEOUT");
  process.exit(1);
}, 30_000);
