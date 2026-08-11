# Session Architecture

How Pi sessions work across the two execution paths, and how native Pi
session state stays the source of truth (ADR-0005).

## Two session kinds

```text
┌──────────────────────────────┬────────────────────────────────────────┐
│ Server-side (mock)           │ Workspace (real Pi)                    │
├──────────────────────────────┼────────────────────────────────────────┤
│ workspaceId: null            │ workspaceId set                        │
│ driver: MockPiDriver         │ driver: EmbeddedPiDriver               │
│ runs in the control server   │ runs in the sandbox container          │
│ UI dev / tests only          │ production path                        │
│ created via POST /api/sessions│ created via                            │
│                              │  POST /api/workspaces/:id/sessions     │
└──────────────────────────────┴────────────────────────────────────────┘
```

Both kinds share:
- the `sessions` table (control-plane metadata only — never transcripts);
- the browser protocol (identical envelopes for streaming, thinking, tools);
- prompt/abort routing: the server looks up the row; if it has a
  `workspaceId` the command goes to the workspace agent, otherwise to the
  mock driver.

## Workspace session lifecycle

1. **Create** — the server generates `session_<uuid>`, inserts the row, and
   sends `agent.session.create {sessionId, title?, model?, thinkingLevel?}`.
   The agent's `SessionSupervisor` calls `EmbeddedPiDriver.create()` →
   `createAgentSession({ cwd: "/workspace", agentDir: "/state/pi-agent",
   sessionManager: SessionManager.create(cwd), modelRuntime })`.
   Native session files land in `/state/pi-agent/sessions/...jsonl`
   (persistent volume — survives container rebuilds).
2. **Prompt** — the server publishes `user.message` (the embedded driver
   does not re-emit it), then forwards `agent.session.prompt`. Streaming
   driver events come back as `agent.session.event` envelopes and are
   published to browsers with seq numbers.
3. **Control** — abort/compact/setModel/setThinkingLevel forward 1:1; model ids use `provider/model` form (e.g. `deepseek/deepseek-v4-pro`).
4. **Resume** — `POST /api/workspaces/:id/sessions/resume`
   `{nativeSessionPath}` → `agent.session.resume` →
   `createAgentSession({ sessionManager: SessionManager.open(path) })`.
   Verified: after a workspace restart the resumed session recalled the
   earlier conversation.
5. **Reconnect** — when the control server restarts, it reconnects to each
   running workspace's agent (`restoreAgents`); `agent.ready` carries the
   live process list and session list for re-sync. Live session objects are
   agent-owned; after a container restart they are gone (native files
   persist) and must be resumed explicitly.

## Event mapping

`packages/pi-driver/src/events.ts` maps normalized `PiDriverEvent`s to
protocol `EventEnvelopeInit`s. This single function is used by:
- the workspace agent (real Pi events → agent.session.event), and
- the control server (mock driver events, and re-publishing agent events).

Real-SDK mapping notes (pi 0.84.1, validated live):
- thinking arrives as `message_update:thinking_*` — mapped to
  `thinking.start|delta|end`;
- tool calls announce as `message_update:toolcall_*` (ignored) and execute
  as `tool_execution_start|update|end` — mapped to `tool.*`;
- text arrives as `message_update:text_start|delta|end` — the ONLY thing
  that opens/closes the assistant message in the UI. `message_end` fires
  per segment (a thinking-only message ends before tools run), so it must
  not close the stream.

## Credentials

The control server forwards provider env vars (`ANTHROPIC_API_KEY`,
`DEEPSEEK_API_KEY`, …) in the `agent.hello` payload. The agent applies them
to its process env; `ModelRuntime` resolves them (env resolution priority).
This is the documented V1 boundary — child shells inherit the env until the
credential broker (Phase 7+) scrubs them (ADR-0010).
