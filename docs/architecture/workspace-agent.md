# Workspace Agent Architecture

See ADR-0006 for the decision; this page details the Phase 2+ design and
the Phase 3 additions.

## Purpose

`pi-control-workspace-agent` is a long-lived service inside each workspace
container. It is the *only* thing inside the sandbox that talks to the
control server. It owns:

- Pi session lifecycle via `SessionSupervisor` + `EmbeddedPiDriver`;
- translation of Pi driver events into protocol envelope inits;
- PTYs and terminals (Phase 8);
- long-running workspace processes (detached, survives server restarts);
- health/resource reporting (5s heartbeat);
- one-shot exec for controlled operations.

## Why not `podman exec`

Repeated exec gives no stable process ownership, no deterministic event
routing, and breaks terminals/reconnect. A long-lived agent pays startup
cost once and provides clean supervision (plan §11.2).

## Communication

- Versioned agent protocol (`packages/protocol/src/agent.ts`) over an
  authenticated WebSocket.
- **Direction**: the control server connects OUT to the agent. The
  workspace container publishes `127.0.0.1:<hostPort>:4175` at creation;
  the agent listens on 4175 inside the sandbox and the server connects to
  the host-side forward. This works identically on Linux, macOS and
  Windows/WSL machines.
- **Auth**: per-sandbox random token (32 random bytes, hex) generated at
  workspace creation, stored in the sandbox record, injected as
  `PI_CONTROL_AGENT_TOKEN`, presented as `Authorization: Bearer` on the
  upgrade (constant-time compare, 4001 on failure).
- Inside the container the agent binds `0.0.0.0` because published ports
  route to the container interface — not public exposure since the host
  side is loopback-only and token-authenticated.
- Heartbeat + health reporting; the server reconnects with backoff and
  re-syncs state (`agent.ready` carries processes + sessions).

## Agent protocol (summary)

**Commands (server → agent):** `agent.hello` (identity + provider env),
`agent.ping`, `agent.exec`, `agent.process.spawn|kill|list`,
`agent.session.create|resume|prompt|steer|followUp|abort|compact|setModel|
setThinkingLevel|list`, `agent.shutdown`. The prompt/steer/followUp
commands optionally carry `nativeSessionPath`/`nativePiSessionId`: when the
control session is not live, `SessionSupervisor.ensureLive()` re-opens the
native Pi session from that file (by path, or by session-id filename match)
before dispatching — the auto-recovery path for prompts on stopped
sandboxes (the server starts the sandbox first).

**Events (agent → server):** `agent.ready`, `agent.health`,
`agent.ok` (command response), `agent.exec.output|exit`,
`agent.process.started|output|exited|list`,
`agent.session.created|event|list`, `agent.error`.

Every command carries a request id; responses carry it back
(`commandId`) so the server resolves pending requests. Broadcast events
(process output, session driver events) flow without request ids.

## Internal components (Phase 3)

```text
workspace-agent
├── agent server             token auth, command dispatch, broadcast
├── SessionSupervisor        Map<controlSessionId, ManagedPiSession>
├── EmbeddedPiDriver         official Pi SDK (ESM, lazy file-URL import)
├── ProcessSupervisor        detached processes, output ring buffer
└── exec                     one-shot commands (timeout, output cap)
```

`EmbeddedPiDriver` loads `@earendil-works/pi-coding-agent` lazily: the CJS
bundle cannot `import()` bare ESM specifiers (NODE_PATH is ignored by ESM)
and `require.resolve` cannot resolve ESM-only exports, so the driver walks
`NODE_PATH` entries + `node_modules` ancestors + the image's fixed
`/opt/pi-control/node_modules` location and imports the entry file by URL.
See `packages/pi-driver/src/embedded.ts` and the base image Dockerfile.

Tool arguments: pi's `tool_execution_start` extension event carries the
arguments as `args` (the SDK does not emit an `input` field) — the driver
maps `args` (best-effort JSON.parse for string args) into the
`tool.start` input so the UI shows the real invocation.

## Relationship to the control server

- The control server is authoritative for workspace lifecycle
  (start/stop/rebuild) and never embeds the active agent runtime.
- The workspace agent is authoritative for anything inside the sandbox.
- The browser never talks to the workspace agent directly — everything goes
  through the control server (Invariant F).
