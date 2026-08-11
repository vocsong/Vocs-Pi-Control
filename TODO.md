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

## Phase 1 — Podman Runtime Bootstrap (complete)

- [x] Podman detection (linux/macos/win32) via `podman --version` + `podman info`
- [x] rootless validation; refusal to continue on rootful (no silent fallback)
- [x] Podman Machine detect/create/start for macOS/Windows (dedicated `pi-control`
      machine; positional name for podman 5.x with `--name` fallback for 4.x)
- [x] `RootlessPodmanRuntime` adapter: create/start/stop/remove container,
      exec, logs, build/pull image, listPorts
- [x] explicit bind mount + named volumes (/home/pi, /state, /cache, /tools),
      tmpfs /tmp + /run
- [x] resource limits (CPU/mem/PIDs) with host-capacity detection
      (`defaultResources`: 2–4 CPU, 4–8 GiB, PID 512)
- [x] security flag builder (`buildCreateArgs`) with unit-tested non-negotiable
      posture (no privileged/socket/host-ns/devices, no-new-privileges)
- [x] path translation for Podman Machine hosts (win32 → /mnt/<drive>,
      macOS home share, linux passthrough)
- [x] base image Dockerfile (`images/base`) — node 22 + git + tools, sandbox
      env/PATH policy
- [x] security self-test: /workspace RW, host home absent, socket absent,
      no host mounts, cleanup
- [x] control server: runtime selection (auto/mock/podman), SandboxManager
      (projects/workspaces/sandboxes + lifecycle), sandbox status/prepare/
      self-test endpoints, restore registrations after restart
- [x] real Podman integration verified on Windows 11 (podman 5.8.3, WSL
      machine): all self-test checks pass; repo mounted as /workspace;
      writes bidirectional; host home + sockets absent
- [ ] macOS/Ubuntu matrix verification

## Phase 2 — Workspace Agent (complete)

- [x] `pi-control-workspace-agent` process/service (apps/workspace-agent):
      WebSocket server with per-sandbox token auth (Bearer, constant-time)
- [x] authenticated control-server connection — server connects OUT to the
      agent's loopback-forwarded port (works on Linux/WSL/macOS machines)
- [x] health/heartbeat (5s: memory, cpu%, process count) + reconnect with
      backoff and process-list re-sync on ready
- [x] exec abstraction (run command, stream output, timeout, output cap)
- [x] process supervision: spawn (detached process group), kill, list,
      output streaming with bounded ring buffer
- [x] control server: AgentClient + AgentManager (per-workspace connection,
      event bridging to browser envelopes: agent.state/health,
      process.started/output/exited)
- [x] per-sandbox secret + loopback-forwarded agent port at workspace
      creation; persisted in sandbox configJson; restore after restart
- [x] REST: exec, processes (list/spawn/kill), agent status
- [x] base image runs the agent as ENTRYPOINT (CJS bundle — ws needs CJS)
- [x] verified live: agent connected inside rootless container; spawned
      process survived a control-server restart; re-sync + kill work

Acceptance: control server stop/reconnect without losing agent-managed
processes — **verified on Windows 11 + WSL machine**.

## Phase 3 — Real Pi Integration (complete)

- [x] `EmbeddedPiDriver` using the official Pi SDK (`createAgentSession`, 0.84.x)
- [x] create session with persistent `SessionManager.create(cwd)` — native
      sessions live in `/state/pi-agent/sessions` (survive container rebuilds)
- [x] resume via `SessionManager.open(path)` (verified: restarted workspace,
      resumed session recalled the earlier conversation)
- [x] prompt / steer / followUp / abort / compact / setModel / setThinkingLevel
- [x] streaming: text deltas, thinking deltas, tool executions (bash + write
      verified with real outputs)
- [x] model/thinking info; usage via session snapshot
- [x] event mapping fixed against the real SDK: text_start/delta/end bound
      to the UI stream; thinking/toolcall segments don't close messages
- [x] ESM-only pi loaded via manual NODE_PATH resolution in the CJS bundle
- [x] provider credentials: control server forwards env keys at agent hello
      (V1 boundary, ADR-0010)
- [x] workspace sessions: create/resume/prompt/abort REST + WS routing
- [x] base image installs pi (0.84.1, pinned, NODE_PATH)
- [ ] UI session creation for workspaces (Phase 5 navigation)

Acceptance: Pi inside sandbox inspected /workspace (bash ls), wrote
`phase3-proof.txt` (visible on host), ran tests, streamed everything through
browser protocol; host home/sockets stayed absent — **verified live**.

## Phase 4 — Reconnect Hardening (complete)

- [x] sequence numbers, bounded replay buffers (Phase 0)
- [x] authoritative snapshot when replay cannot satisfy the gap: buffer
      empty (restart), lastSeq older than buffer, or client ahead of server
      — verified live after a real server restart
- [x] command request IDs + duplicate protection (Phase 0)
- [x] browser editing lease (plan §27): take/release/heartbeat (20s), TTL
      expiry, force takeover, auto-release on socket close, optional prompt
      enforcement (`PI_CONTROL_ENFORCE_LEASES=1`) — verified with two
      concurrent clients
- [x] persisted event checkpoints (event_checkpoints) on session events
- [x] server/workspace-agent reconnect with re-sync (Phase 2)
- [x] web client: auto lease on subscribe + heartbeat, snapshot handling,
      lease banner + Take control in composer

## Phase 5 — Projects/Workspaces/Sessions (complete)

- [x] machine/project/workspace hierarchy + navigation UI (sidebar tree)
- [x] workspace onboarding flow (add folder → validate → sandbox → sessions)
- [x] verified: full UI flow — project → workspace → start → real Pi session

## Phase 6 — Files (complete)

- [x] explorer/editor (CodeMirror) with lazy tree, save/dirty, create/
      rename/delete, image + markdown previews
- [x] containment tests (lexical + realpath, symlink-aware; traversal and
      absolute-path attempts rejected — verified live)

## Phase 7 — Git/Worktrees (complete)

- [x] status/diff/stage/unstage/commit/branches/log via controlled Git
      service (porcelain -z parsing unit-tested)
- [x] worktree creation → separate workspace/container (Invariant D),
      <parent>/.pi-control-worktrees/<project>/<name>

## Phase 8 — Terminals/Processes/Ports (complete)

- [x] PTY (node-pty in container, pipe fallback elsewhere), xterm.js,
      multi-tab, reconnect replay, resize
- [x] process manager + app runner (dev-port range 43100-43119 published
      loopback-only; verified: server on 43100 served on the host URL)

## Phase 9 — Pi Management UX (complete)

- [x] model picker from the real provider catalog (deepseek verified),
      thinking level selector, compact, capabilities popover
      (tools/skills/extensions/prompts — read-only visibility)
- [x] model switch persisted and applied to the next prompt (verified)
- [ ] session tree (native pi tree) — deferred: parent/child metadata lands
      with multi-agent (Phase 14); flat list + lease covers V1

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
