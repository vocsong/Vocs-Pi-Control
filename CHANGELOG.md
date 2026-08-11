# Changelog

All notable changes to Vocs Pi Control are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Added — Phase 0 (foundation)

- pnpm monorepo: `apps/server`, `apps/web`, `apps/workspace-agent` (skeleton),
  `packages/protocol`, `pi-driver`, `sandbox`, `database`, `shared`, `test-utils`
- Realtime protocol: `EventEnvelope` with global seq, `ClientCommand` with
  request-id idempotency, typed payloads (plan §25/§26)
- RealtimeHub: bounded replay buffer (2,000 events), socket fan-out with
  per-session subscriptions, command deduplication
- `MockPiDriver`: scripted streaming (thinking → tool → assistant → usage),
  abort, queueing
- `MockSandboxRuntime`: in-memory sandbox lifecycle
- SQLite control plane via Drizzle: machines, projects, workspaces, sandboxes,
  sessions, tasks, processes, terminals, artifacts, settings, plugins,
  plugin_permissions, traces, event_checkpoints, security_grants — migrations
  from the first commit
- Control server: Fastify + WebSocket on `127.0.0.1`, pino logging with
  redaction, `/api/health`, `/api/diagnostics`, REST session routes
- Web frontend: React 19 + Vite, session sidebar, streaming chat with thinking
  sections and tool cards, composer, connection/seq status bar, reconnect with
  event replay
- Documentation: ADR 0001–0010, architecture overview/sandbox/workspace-agent,
  threat model, sandbox policy, implementation plan snapshot
