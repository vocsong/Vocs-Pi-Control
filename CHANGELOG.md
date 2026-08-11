# Changelog

All notable changes to Vocs Pi Control are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Added — Phase 1 (Podman runtime bootstrap)

- `RootlessPodmanRuntime`: detect/prepare/create/start/stop/remove, exec,
  logs, image build/pull, ports, capacity — all through the `SandboxRuntime`
  adapter, never raw `podman` calls outside it
- Podman Machine support (win32/macOS): dedicated `pi-control` machine,
  create (positional name for podman 5.x, `--name` fallback for 4.x) and
  start with long timeouts
- Rootless verification with refusal to continue on rootful engines
- Unit-tested container argument builder enforcing the non-negotiable
  security posture (no privileged, no sockets, no host namespaces/devices,
  no-new-privileges, loopback-only ports)
- Path translation for machine hosts (Windows → /mnt/<drive>, macOS home
  share, Linux passthrough)
- Conservative default resource limits from host capacity (2–4 CPU,
  4–8 GiB, PID 512)
- Security self-test: /workspace write, host-home absence, socket absence,
  mount audit, cleanup
- Base image Dockerfile (`images/base`): Node 22, Git, CA certs, sandbox
  env/PATH policy
- Control server: runtime auto-selection, SandboxManager with projects/
  workspaces/sandboxes lifecycle, `/api/sandbox/status|prepare|self-test`,
  project/workspace REST routes, sandbox registration restore on restart
- Protocol: project/workspace/sandbox event types and payloads

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
