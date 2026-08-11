# TODO — Vocs Pi Control

Progress against [`docs/pi-control-implementation-plan.md`](docs/pi-control-implementation-plan.md).
Check off items as they land; keep each phase runnable before moving on.

## Phase 0 — Repository/Foundation (in progress)

- [x] pnpm monorepo (apps/server, apps/web, apps/workspace-agent; packages/protocol,
      pi-driver, sandbox, database, shared, test-utils)
- [x] strict TypeScript base config, `pnpm typecheck`
- [x] shared protocol package (EventEnvelope, ClientCommand, typed payloads)
- [x] MockPiDriver (streaming/thinking/tools/abort/usage)
- [x] MockSandboxRuntime (lifecycle + exec)
- [x] database schema + migrations (all plan §24 tables)
- [x] structured logging with redaction
- [x] health + diagnostics endpoints
- [x] realtime hub: seq, bounded replay, command idempotency, socket fan-out
- [x] WebSocket endpoint + REST session routes
- [x] web frontend: session list, streaming chat, composer, reconnect
- [x] ADRs 0001–0010, architecture + security docs
- [x] vitest unit tests (hub, mock driver, mock sandbox)
- [ ] eslint (flat config) + CI pipeline skeleton
- [ ] Playwright smoke test: create session → prompt → streamed reply

Acceptance: `pnpm install && pnpm dev` shows a working frontend connected to
the server with fake session streaming — **done locally, needs CI wiring**.

## Phase 1 — Podman Runtime Bootstrap

- [ ] Podman detection (linux/macos/win32)
- [ ] rootless validation; subordinate UID/GID diagnostics on Linux
- [ ] Podman Machine detect/create/start for macOS/Windows (dedicated `pi-control` machine)
- [ ] base image build/pull
- [ ] create/start/stop/remove workspace container (rootless, no privileged, no socket)
- [ ] explicit bind mount + named volumes (/home/pi, /state, /cache, /tools)
- [ ] resource limits (CPU/mem/PIDs) with host-capacity detection
- [ ] security self-test (host home absent, socket absent, /workspace RW)

## Phase 2 — Workspace Agent

- [ ] workspace-agent process/service skeleton → real implementation
- [ ] authenticated control-server connection (per-sandbox secret)
- [ ] health/heartbeat, reconnect
- [ ] exec abstraction; process/terminal supervision foundation

## Phase 3 — Real Pi Integration

- [ ] EmbeddedPiDriver using current official Pi SDK/AgentSession APIs
- [ ] create session, native session persistence, resume
- [ ] prompt/steer/follow-up, streaming, thinking/tool events, abort
- [ ] model/thinking/context/usage info

## Phase 4 — Reconnect Hardening

- [ ] event checkpoints persisted per scope
- [ ] authoritative snapshot fallback when replay gap cannot be satisfied
- [ ] browser editing lease

## Phase 5 — Projects/Workspaces/Sessions

- [ ] machine/project/workspace hierarchy + navigation UI
- [ ] workspace onboarding flow (add folder → validate → sandbox → sessions)

## Phase 6 — Files

- [ ] explorer/editor (CodeMirror), containment tests, upload/download, previews

## Phase 7 — Git/Worktrees

- [ ] status/diff/stage/commit/branches via controlled Git service
- [ ] worktree creation → separate workspace/container

## Phase 8 — Terminals/Processes/Ports

- [ ] PTY (xterm.js), process manager, app runner, localhost port proxy

## Phase 9 — Pi Management UX

- [ ] model/thinking controls, session tree, tools/skills/extensions/packages visibility

## Phase 10 — Power UX

- [ ] command palette, quick-open, transcript search, responsive layout, PWA

## Phase 11 — Environment Profiles

- [ ] image profiles (node/python/universal), rebuild flow, /tools persistence

## Phase 12 — Tasks/Trace

- [ ] tasks board, trace/observability view

## Phase 13 — Plugin SDK

- [ ] trusted plugin framework + permissions UI

## Phase 14–17 — Later

- [ ] multi-agent roles/messaging; devcontainer import; remote machines; AG-UI/browser adapters

## Ongoing quality rules (plan §60)

- [ ] re-run sandbox isolation tests before every release
- [ ] add tests with each security boundary
- [ ] ADR for every architectural deviation
