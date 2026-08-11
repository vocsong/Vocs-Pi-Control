# Workspace Agent Architecture

See ADR-0006 for the decision; this page details the design.

## Purpose

`pi-control-workspace-agent` is a long-lived service inside each workspace
container. It is the *only* thing inside the sandbox that talks to the
control server. It owns:

- Pi session lifecycle (create/resume/prompt/abort) via `PiSessionDriver`;
- translation of Pi driver events into pi-control protocol events;
- PTYs and terminals (xterm.js over the protocol);
- long-running workspace processes and dev servers;
- health/resource reporting;
- controlled file/Git/process operations where appropriate;
- reconnect semantics — it survives browser disconnects and control-server
  restarts.

## Why not `podman exec`

Repeated exec gives no stable process ownership, no deterministic event
routing, and breaks terminals/reconnect. A long-lived agent pays startup
cost once and provides clean supervision (plan §11.2).

## Communication

- Versioned protocol (packages/protocol) over an authenticated WebSocket
  between control server and agent.
- Per-sandbox random secret injected at container start, stored in
  control-plane state (`sandboxes.configJson` / env at create time).
- Loopback-only forwarding; the agent endpoint is never public.
- Heartbeat + health reporting; control server marks the agent down on
  timeout and surfaces an actionable status (plan §49).

## Internal components (Phase 2+)

```text
workspace-agent
├── control connection      authenticated WS + heartbeat
├── session supervisor      Map<controlSessionId, ManagedPiSession>
├── pi driver               EmbeddedPiDriver (Phase 3) / MockPiDriver (tests)
├── pty manager             terminal sessions
├── process supervisor      long-running processes, exit codes
└── port reporter           discovered listeners → control server proxy
```

## Relationship to the control server

- Control server is authoritative for workspace lifecycle (start/stop/rebuild)
  and never embeds the active agent runtime (plan §5.1).
- Workspace agent is authoritative for anything inside the sandbox.
- The browser never talks to the workspace agent directly — everything goes
  through the control server (Invariant F).
