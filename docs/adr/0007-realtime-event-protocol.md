# ADR-0007: Realtime event protocol with global sequence and replay

- Status: accepted
- Date: 2026-08-11

## Context

The browser needs live streaming (assistant deltas, thinking, tools) and
reconnect semantics without full transcripts in RAM (plan §25, §26).

## Decision

- One browser WebSocket multiplexes everything; REST remains the resource
  API.
- Every server message is an `EventEnvelope`: `version`, global monotonic
  `seq`, `timestamp`, scope (`server|machine|project|workspace|session`),
  scoping ids, `type`, `payload`.
- The control-server process keeps a bounded in-memory replay buffer
  (2,000 events). On reconnect the client sends `lastSeq`; the server replays
  buffered events, then sends `replay.complete`. If the gap cannot be
  satisfied, the client receives an authoritative snapshot (Phase 4).
- Every mutation is a `ClientCommand` with a request id; the server dedupes
  repeat ids (60s TTL) and answers with `command.ack` / `command.error` /
  `command.duplicate` envelopes.
- Session-scoped events fan out only to sockets subscribed to that session;
  server-scoped events (e.g. `session.created`) fan out to all.

## Consequences

- Deterministic replay without per-scope sequence books.
- Acks share the global seq (harmless, keeps one code path) but are **not**
  buffered: request/response envelopes (`command.ack/error/duplicate`,
  `replay.complete`, `server.hello`) are delivered socket-targeted and never
  re-enter the replay stream (refined during Phase 0 verification).
- When bounded replay cannot satisfy a reconnect gap (empty buffer after a
  server restart, lastSeq older than the buffer, or a client ahead of the
  server), the server sends an authoritative `session.snapshot` instead of
  a partial replay (Phase 4).
- The editing lease (plan §27) is a separate server-side concern
  (`LeaseManager`); leases never block other sessions in the same
  workspace.
