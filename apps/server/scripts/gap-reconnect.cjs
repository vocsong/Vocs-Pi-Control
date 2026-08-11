/* Reconnect with a stale lastSeq after a server restart → authoritative snapshot. */
const ws = new WebSocket("ws://127.0.0.1:5174/ws");
const sid = process.env.SID;
ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ id: "s1", type: "session.subscribe", payload: { sessionId: sid, lastSeq: 25 } }));
});
ws.addEventListener("message", (e) => {
  const env = JSON.parse(String(e.data));
  if (env.type === "session.snapshot") {
    console.log("SNAPSHOT ✓ reason:", env.payload.reason, "| title:", env.payload.session.title, "| status:", env.payload.session.status);
    process.exit(0);
  }
  if (env.type === "replay.complete") {
    console.log("replay.complete (no snapshot) — FAIL");
    process.exit(1);
  }
});
setTimeout(() => {
  console.error("TIMEOUT");
  process.exit(1);
}, 10_000);
