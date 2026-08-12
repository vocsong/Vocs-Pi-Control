# Changelog

All notable changes to Vocs Pi Control are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Added — recent UX + reliability batch

- Chat auto-recovery: prompting a session whose sandbox is stopped now
  auto-starts the sandbox, waits for the agent, and auto-resumes the
  native Pi session before streaming the reply (verified live on a
  stopped sandbox: prompt → `RECOVERED`)
- LOG tab: bounded verbose envelope stream (seq, time, type, scope,
  payload) with session-only filter, type chips, query filter, clear —
  the last 2,000 events are kept in the browser store
- Session rename: `PATCH /api/sessions/:id {title}` + `session.updated`
  event; click-to-edit title in the chat header (Enter saves, Esc cancels)
- Live workspace detection: the root folder is re-scanned every 15s and
  new directories are adopted automatically; `POST /api/workspaces/sync`
  triggers a manual scan
- Clicking a workspace in the sidebar selects its most recently used
  session (by `lastActivityAt`)
- Settings → Session defaults: "Show thinking blocks expanded by default"
  (persisted via `PUT /api/settings/defaults`); completed thinking blocks
  stay expanded instead of collapsing
- Transcript endpoint: `GET /api/sessions/:id/transcript` reads the native
  Pi `.jsonl` (re-open + dispose; never duplicated)
- Model picker dedupe: driver stores qualified `provider/id` model refs;
  legacy id-only rows normalize in the picker

### Fixed

- Tool cards showed `{}` for BASH and every other tool: pi's
  `tool_execution_start` carries arguments as `args`, but the driver read
  `event.input` (never sent). Tool cards now show the real invocation
  (e.g. `{"command": "…"}`)
- Dev-port publishing: `portRanges` was dropped when building container
  create args, so advertised `http://127.0.0.1:<port>` URLs were not
  reachable. Ranges are now actually published AND allocated per-sandbox
  (container ports 43100–43119; host side slot-shifted 43100/43120/… so
  concurrent sandboxes never collide). Verified live: demo + tetris
  running simultaneously, both HTTP 200 on their own mapped URLs

### Added — Phases 10–12 (power UX, environment profiles, tasks/trace)

- Command palette (Ctrl+K), quick-open filename search (Ctrl+P),
  transcript search (Ctrl+F), Alt+Enter follow-up queueing
- PWA baseline (manifest + service worker), responsive sidebar, title
  notifications
- Environment profiles: python + universal images; workspace creation
  accepts a profile; one-click rebuild preserves /workspace and all
  persistent volumes (verified: universal rebuild added ffmpeg while
  workspace/state/cache markers survived)
- Tasks: control-plane CRUD with status transitions and session
  assignment + Tasks tab
- Trace: recorder derives control-plane trace rows from the session
  stream (prompts, assistant runs, tool durations) + live Trace timeline
- One-command quickstart: `npm run quickstart` installs deps, sets up
  Podman, builds the base image, starts server + UI and opens the browser
- README rewritten: one-line setup + feature overview + docs links

### Added — Phases 5–9 (hierarchy UI, files, git, terminals, Pi management)

- Phase 5: projects/workspaces/sessions UI — sidebar tree with onboarding
  forms, start/stop/remove, per-workspace Pi sessions, sandbox panel
- Phase 6: file service with defense-in-depth containment (lexical +
  realpath, symlink-aware) + Files tab (CodeMirror, previews, CRUD)
- Phase 7: controlled Git service (status/diff/stage/unstage/commit/
  branches/log), worktree → new workspace/container (Invariant D), Git tab
- Phase 8: terminal service (node-pty in the image, pipe fallback on host),
  xterm.js terminal tab, processes/app-runner tab, port discovery with
  loopback-only dev-port range exposure
- Phase 9: Pi management — model picker from the real provider catalog,
  thinking levels, compaction, capability visibility (tools/skills/
  extensions/prompts)
- Verified live through real containers on Windows 11 + WSL machine

### Added — Phase 4 (reconnect hardening)

- Authoritative snapshots: when bounded replay cannot satisfy a reconnect
  gap (empty buffer after restart, lastSeq older than the buffer, or a
  client ahead of the server), the server sends `session.snapshot` with
  the current session state instead of partial replay
- Browser editing lease (plan §27): `LeaseManager` with take/release/
  heartbeat (20s TTL), force takeover, auto-release on socket close, and
  optional prompt enforcement (`PI_CONTROL_ENFORCE_LEASES=1`); lease
  events broadcast as `session.lease`; `server.hello` announces the client
  id for holder comparison
- Persisted event checkpoints written for workspace session events
  (`event_checkpoints`)
- Web client: auto-takes the lease on subscribe and heartbeats it,
  handles `session.snapshot` (resets the transcript view with a notice),
  shows a lease banner with "Take control" when another client holds the
  session
- Verified live: two concurrent clients — second take rejected, prompt
  rejected under enforcement, release restores prompting; server restart
  with a stale lastSeq delivered the authoritative snapshot

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
