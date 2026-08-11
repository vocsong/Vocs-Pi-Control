# Architecture Overview

Vocs Pi Control is a local-first web control plane for the Pi coding agent.
This document summarizes the system; the authoritative specification is
[`../pi-control-implementation-plan.md`](../pi-control-implementation-plan.md).
Implemented through Phase 3 (foundation, Podman runtime, workspace agent,
real Pi integration).

## Layering

```text
Browser / PWA
      │  HTTPS/HTTP + WebSocket (pi-control protocol, packages/protocol)
      ▼
Pi Control Server        (apps/server — Fastify, SQLite, RealtimeHub)
      │
      ├── database               control-plane metadata (ADR-0009)
      ├── SandboxManager         projects/workspaces/sandboxes lifecycle
      ├── AgentManager           one AgentClient per workspace (reconnect,
      │                          event bridging, credential forwarding)
      ├── WorkspaceSessionManager  real Pi sessions (routed to agents)
      └── SessionManager         server-side mock sessions (UI dev/tests)
              │
              ▼  (agent protocol, token-authenticated WebSocket,
              │   server connects OUT via loopback-forwarded port)
       Workspace Container
              │
      workspace-agent            (apps/workspace-agent)
      ├── SessionSupervisor      Map<controlSessionId, ManagedPiSession>
      ├── EmbeddedPiDriver       official Pi SDK (createAgentSession)
      ├── ProcessSupervisor      detached processes, output streaming
      └── exec                   one-shot commands
              │
              ▼
       Pi SDK (pi 0.84.1, ESM)   cwd=/workspace, agentDir=/state/pi-agent
```

## Session flows

**Server-side (mock) sessions** — no sandbox required; the control server
embeds `MockPiDriver`. Used by the UI for development and by tests.

**Workspace sessions** — the control server generates the browser-facing
session id, persists the record, and forwards commands to the workspace
agent (`agent.session.*`). The agent's `SessionSupervisor` creates a real
Pi session via `EmbeddedPiDriver`; driver events are normalized into
protocol envelope inits (single mapping in `packages/pi-driver/src/events.ts`)
and streamed back as `agent.session.event` → published with `seq` to
browsers. Prompt/abort REST and WS commands route by session ownership.

Native Pi session files persist under `/state/pi-agent/sessions`
(`SessionManager.create(cwd)`); resume uses `SessionManager.open(path)`.
See [`sessions.md`](sessions.md).

## Realtime protocol (ADR-0007)

- One browser WebSocket; `EventEnvelope` with a global monotonic `seq`.
- Bounded replay buffer (2,000 events). Reconnect: subscribe with
  `lastSeq` → replay → `replay.complete`. Gap → authoritative snapshot
  (Phase 4).
- `ClientCommand` request ids deduplicated server-side (60s TTL).
- Command responses (`command.ack/error/duplicate`) are socket-targeted
  and never re-enter the replay stream.

## Sandbox (Phase 1)

Rootless Podman via `RootlessPodmanRuntime` (all podman calls isolated in
`packages/sandbox`). One container per workspace: explicit bind mount of the
workspace folder as `/workspace`, named volumes (`/home/pi`, `/state`,
`/cache`, `/tools`), tmpfs `/tmp` + `/run`, resource limits, no privileged,
no sockets, no host namespaces, no-new-privileges. Windows/macOS use a
dedicated `pi-control` Podman Machine. Path translation (Windows
`C:\...` → `/mnt/c/...`) is centralized in the adapter. See
[`sandbox.md`](sandbox.md).

## Security posture (summary)

- Deny-by-default host filesystem: only explicitly added workspaces mount.
- Per-sandbox agent token guards the agent endpoint; the workspace agent
  binds `0.0.0.0` inside the container (published ports are loopback-only
  on the host).
- Provider credentials: control server forwards env keys to agents at hello
  (V1 boundary — scrubbing/credential broker is Phase 7+, ADR-0010).
- The server binds `127.0.0.1`; Host/Origin validation and the bootstrap
  token + cookie flow are Phase 2 of ADR-0008 (implemented incrementally).

## Future architecture notes

- Remote machines reuse the same high-level capabilities via a machine agent
  (plan §47); the browser cannot tell local from remote.
- Plugins (plan §39) and AG-UI adapter (plan §41) sit behind the same
  protocol boundaries.
- Devcontainer support (plan §20) is an import/review flow, never an
  auto-approve path.
