/* WS smoke test: connect, create session, prompt, verify streaming + replay. */
/* Uses Node's built-in WebSocket client (Node >= 22). */

const URL_ = "ws://127.0.0.1:5174/ws";
const cmdTypeById = new Map();
const seen = [];
let lastSeq = 0;
let sessionId = null;

function nextId() {
  return Math.random().toString(36).slice(2);
}

function send(ws, type, payload, cmdType) {
  const id = nextId();
  cmdTypeById.set(id, cmdType ?? type);
  ws.send(JSON.stringify({ id, type, payload }));
}

const ws1 = new WebSocket(URL_);

ws1.addEventListener("open", () => {
  console.log("[1] connected");
  send(ws1, "session.create", { title: "Smoke test" }, "create");
});

ws1.addEventListener("message", (event) => {
  const env = JSON.parse(String(event.data));
  seen.push(env.type);
  if (env.seq > lastSeq) lastSeq = env.seq;

  if (env.type === "command.ack") {
    const cmdType = cmdTypeById.get(env.payload.commandId);
    if (!cmdType) return; // replayed ack for an old command — ignore
    console.log(`[1] ack: ${cmdType}`);
    if (cmdType === "create") {
      sessionId = env.payload.sessionId;
      send(ws1, "session.subscribe", { sessionId, lastSeq: 0 }, "subscribe");
    } else if (cmdType === "subscribe") {
      send(ws1, "session.prompt", { sessionId, text: "Smoke test prompt" }, "prompt");
    } else if (cmdType === "prompt") {
      console.log("[1] prompt accepted");
    }
  }
  if (env.type === "session.state") {
    console.log("[1] state:", env.payload.status);
  }
  if (env.type === "assistant.end") {
    console.log(`[1] assistant ended (seq ${lastSeq}); events: ${seen.join(",")}`);
    ws1.close();
    setTimeout(replayTest, 200);
  }
});

function replayTest() {
  console.log("[2] reconnecting for replay test");
  const ws2 = new WebSocket(URL_);
  let replayEvents = 0;
  ws2.addEventListener("open", () => {
    send(ws2, "session.subscribe", { sessionId, lastSeq: 0 }, "subscribe");
  });
  ws2.addEventListener("message", (event) => {
    const env = JSON.parse(String(event.data));
    if (env.type === "command.ack" && cmdTypeById.get(env.payload.commandId) === "subscribe") {
      console.log("[2] subscribed; waiting for replay");
    } else if (env.type === "replay.complete") {
      console.log(
        `[2] replay.complete: replayed ${replayEvents} events, lastSeq ${env.payload.lastSeq}`,
      );
      process.exit(0);
    } else {
      replayEvents++;
    }
  });
}

setTimeout(() => {
  console.error("TIMEOUT; events:", seen.join(","));
  process.exit(1);
}, 25_000);
