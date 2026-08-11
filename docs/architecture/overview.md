# Architecture Overview

Vocs Pi Control is a local-first web control plane for the Pi coding agent.
This document summarizes the system; the authoritative specification is
[`../pi-control-implementation-plan.md`](../pi-control-implementation-plan.md).

## Layering

```text
Browser / PWA
      │  HTTPS/HTTP + WebSocket (pi-control protocol)
      ▼
Pi Control Server        (apps/server — Fastify, SQLite, RealtimeHub)
      │
      ├── database               control-plane metadata (ADR-0009)
      ├── workspace manager      projects/workspaces lifecycle (Phase 5+)
      ├── credential broker      host-side auth mediation (Phase 7+, ADR-0010)
      └── SandboxRuntime         (packages/sandbox — Podman adapter, Phase 1)
              │
              ▼
       Rootless Podman           (rootless, dedicated machine on macOS/Windows)
              │
      ┌───────┴────────┐
Workspace A          Workspace B
Container            Container
      │                │
workspace-agent      workspace-agent     (apps/workspace-agent, Phase 2+)
      │                │
  ┌───┼────┐         ┌─┴──┐
 Pi1 Pi2 Pi3         Pi4 Pi5              (via PiSessionDriver → Pi SDK)
```

## Invariants (plan §57)

| Invariant | Meaning |
|---|---|
| A | Pi is a sandbox workload; never trusted with arbitrary host access |
| B | 1 workspace = 1 sandbox environment (ADR-0003) |
| C | 1 workspace = N cooperating Pi sessions |
| D | independent file work → new Git worktree → new workspace/container |
| E | Pi cannot control Podman; only the control server can |
| F | browser depends only on the pi-control protocol, never Pi/Podman directly |
| G | native Pi session state remains the source of truth (ADR-0005) |
| H | deny-by-default host filesystem: no workspace ⇒ no agent FS access |
| I | security grants are explicit and visible |

## Components (Phase 0 status)

- **`@pi-control/protocol`** — wire contract: `EventEnvelope` (global seq,
  scopes), `ClientCommand` (request ids), typed payloads (ADR-0007).
- **`@pi-control/server`** — Fastify app on `127.0.0.1`; `RealtimeHub`
  (sequence, bounded replay buffer, socket fan-out, command dedupe); REST
  routes (`/api/health`, `/api/diagnostics`, `/api/sessions`); WebSocket
  endpoint `/ws`; `SessionManager` bridging Pi driver events to envelopes.
- **`@pi-control/web`** — React 19 + Vite; zustand for ephemeral live state;
  one WebSocket with reconnect + replay; session sidebar, streaming chat,
  composer, status bar.
- **`@pi-control/pi-driver`** — `PiSessionDriver` interface + `MockPiDriver`
  (ADR-0004).
- **`@pi-control/sandbox`** — `SandboxRuntime` interface + `MockSandboxRuntime`
  (ADR-0002).
- **`@pi-control/database`** — Drizzle schema + SQLite migrations.
- **`@pi-control/workspace-agent`** — skeleton; becomes the in-sandbox agent
  in Phase 2 (ADR-0006).

## Data flow (one prompt, Phase 0)

```text
Composer ──session.prompt──▶ WebSocket ──▶ RealtimeHub (ack + dedupe)
                                              │
                                              ▼
                                     SessionManager ──▶ MockPiDriver
                                              ▲          │ events
                                              │          ▼
  browser store ◀── envelopes (seq) ◀── RealtimeHub ◀── normalize
```

Reconnect: browser resends `session.subscribe { lastSeq }`; hub replays
buffered envelopes and sends `replay.complete`.

## Future architecture notes

- Remote machines reuse the same high-level capabilities via a machine agent
  (plan §47); the browser cannot tell local from remote.
- Plugins (plan §39) and AG-UI adapter (plan §41) sit behind the same
  protocol boundaries.
- Devcontainer support (plan §20) is an import/review flow, never an
  auto-approve path.
