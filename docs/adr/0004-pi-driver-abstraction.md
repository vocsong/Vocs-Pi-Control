# ADR-0004: Pi driver abstraction

- Status: accepted
- Date: 2026-08-11

## Context

Upstream Pi exposes SDK embedding, RPC, and subprocess modes; APIs evolve.
Pi Control must not leak upstream API shapes through the codebase, and the
browser must not depend on the driver implementation (plan §12).

## Decision

- All Pi interaction goes through `PiSessionDriver` (`packages/pi-driver`):
  create/resume, prompt/steer/followUp, abort, compact, model/thinking
  controls, snapshots, normalized `PiDriverEvent` subscriptions.
- V1.0 implementation: `MockPiDriver` (already in use).
- Phase 3 implementation: `EmbeddedPiDriver` using the current official Pi
  SDK/`AgentSession` APIs, validated against upstream docs at implementation
  time.
- Future subprocess variant: `RpcPiDriver` — same interface, no caller changes.

## Consequences

- pi 0.84.x specifics validated against the live SDK (2026-08-11):
  `createAgentSession` + `ModelRuntime.create()` + `SessionManager.create/
  open`; env-var credentials resolve automatically; thinking is emitted as
  `message_update:thinking_*`, tool calls as `toolcall_*` announcements +
  `tool_execution_*`, text as `text_start/delta/end` — and `message_end`
  fires per segment (a thinking-only message ends before tools run), so the
  UI stream must bind to the text phase only.
- The pi package is ESM-only: the CJS agent bundle resolves it via NODE_PATH
  walk + file-URL import; the image installs it under
  `/opt/pi-control/node_modules`.
- Upstream churn is contained in one package.
- Normalized events map 1:1 to protocol envelopes, keeping the realtime
  protocol stable.
- We can test the entire stack without provider calls.
