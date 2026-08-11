# ADR-0005: Native Pi sessions remain the source of truth

- Status: accepted
- Date: 2026-08-11

## Context

Pi has its own session format and session tree. The plan forbids replacing
native Pi session storage (plan §2.3, §9.2) and requires session persistence
across container rebuilds.

## Decision

- Pi Control metadata (control-plane `sessions` table) references native Pi
  sessions (`nativePiSessionId`, `nativePiSessionPath`) rather than duplicating
  transcripts.
- Native session files live on the persistent `/state` volume inside the
  sandbox (`PI_CODING_AGENT_SESSION_DIR=/state/pi-sessions`), so container
  replacement preserves conversation history.
- Session resume goes through the Pi driver (`resume(nativeSessionIdOrPath)`).

## Consequences

- Pi Control never parses or rewrites Pi transcripts.
- Workspace deletion must distinguish container teardown from permanent state
  deletion; native session history is never destroyed on rebuild (plan §9.2).
- Replay of streamed events is bounded (plan §26); the native session is the
  authoritative transcript.

## Implementation notes (Phase 3, pi 0.84.1)

- Native sessions are created with `SessionManager.create(cwd)` where
  `cwd=/workspace`; files land under `/state/pi-agent/sessions/...jsonl`
  (persistent volume — verified to survive workspace restarts).
- Resume uses `SessionManager.open(path)` via
  `POST /api/workspaces/:id/sessions/resume`; verified live that a resumed
  session recalls the earlier conversation.
- The control-plane `sessions` table stores only `nativePiSessionId` and
  `nativePiSessionPath` references, never transcript content.
