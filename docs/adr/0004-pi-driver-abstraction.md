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

- Upstream churn is contained in one package.
- Normalized events map 1:1 to protocol envelopes, keeping the realtime
  protocol stable.
- We can test the entire stack without provider calls.
