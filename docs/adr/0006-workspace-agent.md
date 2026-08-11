# ADR-0006: Long-lived workspace agent inside each sandbox

- Status: accepted
- Date: 2026-08-11

## Context

Running Pi sessions via repeated `podman exec` from the host is fragile:
process ownership, PTYs, terminals and reconnect semantics become hard to
manage, and it couples the control server to container internals (plan §11.2).

## Decision

- Each workspace container runs a long-lived **workspace agent**
  (`apps/workspace-agent`), authenticated to the control server with a random
  per-sandbox secret injected at startup and stored only in control-plane
  state.
- The agent owns Pi session lifecycle (via the Pi driver), PTYs, long-running
  processes, and health/resource reporting.
- V1 transport: authenticated localhost WebSocket between control server and
  agent (via container port forwarding), versioned protocol.
- The agent endpoint is never exposed publicly.

## Consequences

- The control server stays thin; host-side code never touches Pi processes.
- Browser disconnects don't disturb agent-managed processes (plan §18, §26).
- Transport direction is server→agent: the workspace container publishes a
  loopback-only forwarded port at creation; the agent listens inside and the
  control server connects out to it. This works identically on Linux,
  macOS and Windows/WSL machines. Inside the container the agent binds
  `0.0.0.0` because published ports route to the container's network
  interface rather than its loopback — this is not public exposure because
  the host-side publish is loopback-only and token-authenticated.
- Phase 2 must deliver the agent + protocol before Phase 3 real Pi work.
