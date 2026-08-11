# Changelog

All notable changes to Vocs Pi Control are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Added — Phase 3 (real Pi integration)

- `EmbeddedPiDriver` (packages/pi-driver): wraps the official Pi SDK
  (`createAgentSession`, pi 0.84.1) — create/resume/prompt/steer/followUp/
  abort/compact/setModel/setThinkingLevel; persistent native sessions via
  `SessionManager.create(cwd)` under `/state/pi-agent/sessions`; event
  mapping tuned against the real SDK event stream (thinking deltas,
  toolcall segments, text_start/delta/end, tool_execution_*)
- ESM-only pi loaded from the CJS agent bundle via manual NODE_PATH/
  node_modules resolution + direct file-URL import
- Base image installs pinned pi under /opt/pi-control/node_modules
- Agent session protocol: create/resume/prompt/steer/followUp/abort/
  compact/setModel/setThinkingLevel/list; driver events forwarded as
  protocol envelope inits (single mapping in pi-driver/events.ts)
- Workspace sessions on the server: control-plane records + routing
  (REST `/api/workspaces/:id/sessions[/resume]`, prompt/abort routes by
  ownership), DB status sync from agent events
- Provider credentials: control server forwards env keys to the agent at
  hello (documented V1 boundary — scrubbing arrives with the credential
  broker)
- Verified live: real DeepSeek run inside the rootless container — bash +
  write tools executed, `phase3-proof.txt` landed on the host, 130 text
  deltas streamed through the browser protocol, native session resume
  after a workspace restart recalled the earlier conversation

### Added — Phase 2 (workspace agent)

- `pi-control-workspace-agent` (apps/workspace-agent): long-lived agent
  running inside each sandbox; WebSocket server authenticated with a random
  per-sandbox token (Bearer, constant-time compare); heartbeat/health every
  5s; exec with timeout/output cap; detached process supervision with
  streaming output and bounded ring buffer; survives control-server
  restarts and re-syncs its process list on reconnect
- Agent protocol (`packages/protocol/agent.ts`): versioned commands and
  events with request-id responses (`agent.ok`, commandId-carrying replies)
- Transport: control server connects OUT to the agent via a loopback-only
  forwarded port allocated per workspace (works across Linux, macOS and
  Windows/WSL machines); inside the container the agent binds 0.0.0.0
  (published ports route to the container interface, host side stays
  loopback-only)
- Control server: AgentClient (reconnect with backoff) + AgentManager
  (per-workspace connections, bridging agent events to browser envelopes
  `agent.state`, `agent.health`, `process.started/output/exited`)
- Sandbox manager: per-workspace agent token + port allocation, env
  injection, endpoint restore after restart
- REST: `/api/workspaces/:id/agent`, `/exec`, `/processes` (list/spawn),
  `/processes/:id/kill`
- Base image: agent bundled (CJS — `ws` uses dynamic requires) and set as
  the container ENTRYPOINT; `pnpm image:base` builds both
- Verified live: agent connected through the forwarded port inside a
  rootless container; spawned process survived a full control-server
  restart; reconnect re-synced state; kill terminated the process group

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
