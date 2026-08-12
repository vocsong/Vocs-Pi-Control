# API Reference

The control server exposes REST resources and one WebSocket endpoint.
REST is for resources; the WebSocket multiplexes live events and mutation
commands (plan §25, §28). Base URL: `http://127.0.0.1:5174` (loopback only).

## Authentication (issue #1 / ADR-0008)

The control plane is protected by a bootstrap token. On first start the
server generates one, persists it in the local settings table, and prints
it to the console. The browser exchanges it for an HttpOnly
`SameSite=Strict` session cookie; every `/api` path except the three below
requires a valid session. `Host` and `Origin` headers are validated on
every request (loopback allowlist, configurable via `PI_CONTROL_ALLOWED_HOSTS`).

| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/status` | `{authenticated}` — no session required |
| POST | `/api/auth/login` | `{token}` — returns the session cookie |
| POST | `/api/auth/logout` | destroys the session cookie |

## Health / diagnostics

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | status, version, runtime, sandbox detection, db, realtime seq (public) |
| GET | `/api/diagnostics` | versions, sandbox state, entity counts |

## Sandbox runtime

| Method | Path | Description |
|---|---|---|
| GET | `/api/sandbox/status` | podman detection result (rootless, machine state) |
| POST | `/api/sandbox/prepare` | create/start the dedicated machine, verify rootless |
| POST | `/api/sandbox/self-test` | isolation proof (10 checks incl. uid != 0, CapEff == 0, ~15s) |

## Workspaces (folder records) and sandboxes (containers)

A **workspace** is a folder under the workspace root; it owns exactly one
**sandbox** (container). Most operations target the sandbox id.

| Method | Path | Description |
|---|---|---|
| GET | `/api/workspaces` | list workspaces |
| POST | `/api/workspaces` | `{name, hostRootPath?}` — create workspace + primary sandbox (auto-started) |
| POST | `/api/workspaces/sync` | re-scan the root folder and adopt new directories (also every 15s) |
| GET | `/api/workspaces/:workspaceId/sandboxes` | sandboxes of a workspace (one by invariant) |
| POST | `/api/workspaces/:workspaceId/sandboxes` | `{name?, hostPath?, securityProfile?, profile?}` — create sandbox |
| POST | `/api/workspaces/:workspaceId/start` \| `/stop` | workspace-level start/stop of its sandbox |
| POST | `/api/workspaces/:workspaceId/worktrees` | `{name, branch?}` — git worktree + NEW workspace/container |
| GET | `/api/sandboxes` | all sandboxes |
| GET | `/api/sandboxes/:sandboxId` | sandbox info (status, dev host range, image) |
| POST | `/api/sandboxes/:sandboxId/start` \| `/stop` | container lifecycle |
| POST | `/api/sandboxes/:sandboxId/rebuild` | stop + recreate container from the profile image |
| POST | `/api/sandboxes/:sandboxId/remove` | remove container (volumes retained; slot released) |

## Workspace agent / processes / ports

| Method | Path | Description |
|---|---|---|
| GET | `/api/sandboxes/:sandboxId/agent` | agent connection state + health + processes |
| POST | `/api/sandboxes/:sandboxId/exec` | `{command: string[], cwd?, timeoutMs?, maxOutputBytes?}` — one-shot exec |
| GET | `/api/sandboxes/:sandboxId/processes` | supervised processes |
| POST | `/api/sandboxes/:sandboxId/processes` | `{name?, command, cwd?, env?}` — spawn detached process |
| POST | `/api/sandboxes/:sandboxId/processes/:processId/kill` | terminate process group |
| GET | `/api/sandboxes/:sandboxId/ports` | listening container ports → host loopback URLs (slot-aware) |

Port mapping: containers listen on **43100–43119**; the host side shifts by
a per-sandbox slot (`43100`, `43120`, …) so concurrent sandboxes never
collide. Use `/api/sandboxes/:sandboxId/ports` for authoritative host URLs
(issue #9/#10).

## Files

Paths are workspace-relative; containment (incl. symlink/reparse-point
rejection) is enforced agent-side (issue #2).

| Method | Path | Description |
|---|---|---|
| GET | `/api/sandboxes/:sandboxId/files?path=` | directory entries |
| GET | `/api/sandboxes/:sandboxId/file?path=` | file content (utf8/base64, truncated) |
| PUT | `/api/sandboxes/:sandboxId/file` | `{path, content, encoding?}` |
| POST | `/api/sandboxes/:sandboxId/file/mkdir` \| `/remove` \| `/rename` | filesystem ops |
| GET | `/api/sandboxes/:sandboxId/file/search?q=` | filename search (quick-open) |

## Git

| Method | Path | Description |
|---|---|---|
| GET | `/api/sandboxes/:sandboxId/git/status` | branch, ahead/behind, changes |
| GET | `/api/sandboxes/:sandboxId/git/diff?staged=1` | unified diff |
| POST | `/api/sandboxes/:sandboxId/git/stage` \| `/unstage` | `{paths: string[]}` |
| POST | `/api/sandboxes/:sandboxId/git/commit` | `{message}` → hash |
| GET | `/api/sandboxes/:sandboxId/git/branches` | branch list + current |
| POST | `/api/sandboxes/:sandboxId/git/branches` | `{name, from?}` create + checkout |
| GET | `/api/sandboxes/:sandboxId/git/log` | recent commits |
| GET | `/api/workspaces/:workspaceId/worktrees` | worktree list |

## Terminals

| Method | Path | Description |
|---|---|---|
| GET | `/api/sandboxes/:sandboxId/terminals` | open terminals (+ output buffer for replay) |
| POST | `/api/sandboxes/:sandboxId/terminals` | open terminal |
| POST | `.../terminals/:terminalId/input` \| `resize` \| `close` | terminal control |

Live input/output also flows over the WebSocket (`terminal.open/input/resize/close`
commands, `terminal.output/closed` events).

## Sessions

Sessions are either **server-side** (mock driver, `workspaceId: null`) or
**workspace sessions** (real Pi inside a sandbox). Prompt/abort route by
ownership automatically. Native Pi transcripts stay in the sandbox
(`/state/pi-sessions`); the control plane never duplicates them (ADR-0005).

| Method | Path | Description |
|---|---|---|
| GET | `/api/sessions` | all sessions (both kinds) |
| POST | `/api/sessions` | create server-side (mock) session |
| POST | `/api/sandboxes/:sandboxId/sessions` | create real Pi session in the sandbox |
| POST | `/api/sandboxes/:sandboxId/sessions/resume` | `{nativeSessionPath}` — resume native pi session |
| GET | `/api/sessions/:sessionId` | session info |
| PATCH | `/api/sessions/:sessionId` | `{title}` — rename; broadcasts `session.updated` |
| POST | `/api/sessions/:sessionId/prompt` | `{text}` — **auto-recovers**: starts a stopped sandbox and resumes the native Pi session first |
| POST | `/api/sessions/:sessionId/abort` | abort current run |
| DELETE | `/api/sessions/:sessionId` | dispose + delete |

## Pi management (Phase 9)

| Method | Path | Description |
|---|---|---|
| GET | `/api/sessions/:sessionId/capabilities` | model, thinking, tools, skills, extensions, prompts |
| GET | `/api/sessions/:sessionId/transcript` | transcript read from the native Pi `.jsonl` |
| GET | `/api/sessions/:sessionId/traces` | persisted control-plane trace rows (issue #13) |
| GET | `/api/sandboxes/:sandboxId/models` | provider model catalog (auth-filtered) |
| POST | `/api/sessions/:sessionId/model` | `{model: "provider/id"}` |
| POST | `/api/sessions/:sessionId/thinking` | `{level: off\|minimal\|low\|medium\|high\|xhigh\|max}` |
| POST | `/api/sessions/:sessionId/compact` | compact context |

## Tasks

| Method | Path | Description |
|---|---|---|
| GET | `/api/sandboxes/:sandboxId/tasks` | task list |
| POST | `/api/sandboxes/:sandboxId/tasks` | `{title, description?}` |
| PATCH | `/api/tasks/:taskId` | `{status?, assignedSessionId?}` |

## Settings

Provider keys are stored locally in SQLite (plaintext in the V1 boundary,
ADR-0010), applied to the server env, and forwarded to agents at hello;
user-launched children get a scrubbed environment (issue #5).

| Method | Path | Description |
|---|---|---|
| GET | `/api/settings` | snapshot: providers (configured flags), session defaults, root folder |
| PUT | `/api/settings/providers` | `{keys: {DEEPSEEK_API_KEY: "…", …}}` — empty string removes a key; agents reconnect |
| PUT | `/api/settings/defaults` | `{defaultModel?, defaultThinkingLevel?, showThinkingByDefault?}` |
| PUT | `/api/settings/root` | `{path}` — workspace root folder; `null` clears |

## WebSocket — `/ws`

One connection multiplexes everything; the upgrade requires the session
cookie (close code `4401` otherwise). Two message shapes:

**Client → server (mutations):**
```json
{ "id": "<request-id>", "type": "session.prompt", "payload": { "sessionId": "...", "text": "..." } }
```
Command types: `session.create`, `session.prompt`, `session.abort`,
`session.subscribe`, `session.unsubscribe`, `session.replay`, `health.ping`,
`terminal.open/input/resize/close`, `session.lease.take/release/heartbeat`.
Request ids are deduplicated server-side (60s) for idempotency after
reconnect; messages are limited to 128 KB and 300 per 10s (issue #1).

**Server → client (events):** every message is an `EventEnvelope`:

```json
{
  "version": 1, "seq": 42, "timestamp": 1786432000000,
  "scope": "session", "sessionId": "...",
  "type": "assistant.delta", "payload": { "sessionId": "...", "messageId": "...", "content": "Hello" }
}
```

- `seq` is global and monotonic per server process; clients track the last
  seen seq and pass it to `session.subscribe` for bounded replay.
- Command responses are envelopes: `command.ack` / `command.error` /
  `command.duplicate` (socket-targeted, never replayed). `server.hello`
  announces the client id (used for editing-lease comparisons).
- Reconnect: subscribe with `lastSeq` → server replays buffered events →
  `replay.complete`. If bounded replay cannot satisfy the gap (empty buffer
  after restart, lastSeq older than the buffer, or client ahead of the
  server), the server sends an authoritative `session.snapshot` instead
  (Phase 4).
- Editing lease (plan §27): `session.lease.take` (optionally `force`),
  `session.lease.heartbeat` (20s TTL), `session.lease.release`; holder
  changes broadcast as `session.lease`. Prompts are rejected for
  non-holders when enforcement is on (`PI_CONTROL_ENFORCE_LEASES=1`); the
  REST prompt route enforces the same lease then (issue #1).

Event types (scope): `session.created` (server), `session.state`,
`user.message`, `assistant.start|delta|end`, `thinking.start|delta|end`,
`tool.start|update|end|error`, `model.updated`, `session.updated`,
`usage.updated`, `session.error`, `session.closed` (session),
`workspace.created|state|error` (workspace), `agent.state|health`,
`process.started|output|exited` (workspace), `project.created`,
`sandbox.status|prepare|selftest` (server).

## Agent protocol (server ↔ workspace agent)

Not browser-facing; summarized in
[`docs/architecture/workspace-agent.md`](docs/architecture/workspace-agent.md).
Transport: server connects OUT to `ws://127.0.0.1:<hostPort>` with
`Authorization: Bearer <per-sandbox-token>`.
