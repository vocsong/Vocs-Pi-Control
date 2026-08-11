# API Reference

The control server exposes REST resources and one WebSocket endpoint.
REST is for resources; the WebSocket multiplexes live events and mutation
commands (plan §25, §28). Base URL: `http://127.0.0.1:5174` (loopback only).

## REST

### Health / diagnostics

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | status, version, runtime, sandbox detection, db, realtime seq |
| GET | `/api/diagnostics` | versions, sandbox state, entity counts |

### Sandbox runtime

| Method | Path | Description |
|---|---|---|
| GET | `/api/sandbox/status` | podman detection result (rootless, machine state) |
| POST | `/api/sandbox/prepare` | create/start the dedicated machine, verify rootless |
| POST | `/api/sandbox/self-test` | isolation proof (8 checks, ~15s) |

### Projects / workspaces

| Method | Path | Description |
|---|---|---|
| GET | `/api/projects` | list projects |
| POST | `/api/projects` | `{name, hostRootPath}` — validates the folder |
| GET | `/api/workspaces` | list all workspaces |
| GET | `/api/projects/:projectId/workspaces` | list per project |
| POST | `/api/projects/:projectId/workspaces` | `{name, hostPath, securityProfile?, imageRef?, resources?}` — creates sandbox + container |
| GET | `/api/workspaces/:workspaceId` | workspace info |
| POST | `/api/workspaces/:workspaceId/start` | start container + connect agent |
| POST | `/api/workspaces/:workspaceId/stop` | stop container + disconnect agent |
| POST | `/api/workspaces/:workspaceId/remove` | remove container (persistent volumes retained) |

### Workspace agent / processes

| Method | Path | Description |
|---|---|---|
| GET | `/api/workspaces/:workspaceId/agent` | agent connection status + health + processes |
| POST | `/api/workspaces/:workspaceId/exec` | `{command: string[], cwd?, timeoutMs?, maxOutputBytes?}` — one-shot exec |
| GET | `/api/workspaces/:workspaceId/processes` | supervised processes |
| POST | `/api/workspaces/:workspaceId/processes` | `{name?, command, cwd?, env?}` — spawn detached process |
| POST | `/api/workspaces/:workspaceId/processes/:processId/kill` | terminate process group |
| GET | `/api/workspaces/:workspaceId/ports` | listening ports mapped to host loopback URLs (dev range 43100–43119) |

### Files (Phase 6)

Paths are workspace-relative; containment is enforced agent-side.

| Method | Path | Description |
|---|---|---|
| GET | `/api/workspaces/:id/files?path=` | directory entries |
| GET | `/api/workspaces/:id/file?path=` | file content (utf8/base64, truncated) |
| PUT | `/api/workspaces/:id/file` | `{path, content, encoding?}` |
| POST | `/api/workspaces/:id/file/mkdir` / `remove` / `rename` | filesystem ops |

### Git (Phase 7)

| Method | Path | Description |
|---|---|---|
| GET | `/api/workspaces/:id/git/status` | branch, ahead/behind, changes |
| GET | `/api/workspaces/:id/git/diff?staged=1` | unified diff |
| POST | `/api/workspaces/:id/git/stage` / `unstage` | `{paths: string[]}` |
| POST | `/api/workspaces/:id/git/commit` | `{message}` → hash |
| GET | `/api/workspaces/:id/git/branches` | branch list + current |
| POST | `/api/workspaces/:id/git/branches` | `{name, from?}` create + checkout |
| GET | `/api/workspaces/:id/git/log` | recent commits |
| POST | `/api/projects/:projectId/worktrees` | `{name, branch?}` — creates worktree + NEW workspace/container |

### Terminals (Phase 8)

| Method | Path | Description |
|---|---|---|
| GET | `/api/workspaces/:id/terminals` | open terminals (+ output buffer for replay) |
| POST | `/api/workspaces/:id/terminals` | open terminal |
| POST | `.../terminals/:terminalId/input` \| `resize` \| `close` | terminal control |

Live input/output also flows over the WebSocket (`terminal.open/input/resize/close` commands, `terminal.output/closed` events).

### Sessions

Sessions are either **server-side** (mock driver, `workspaceId: null`) or
**workspace sessions** (real Pi inside a sandbox). Prompt/abort route by
ownership automatically.

| Method | Path | Description |
|---|---|---|
| GET | `/api/sessions` | all sessions (both kinds) |
| POST | `/api/sessions` | create server-side (mock) session |
| POST | `/api/workspaces/:workspaceId/sessions` | create real Pi session in the sandbox |
| POST | `/api/workspaces/:workspaceId/sessions/resume` | `{nativeSessionPath}` — resume native pi session |
| GET | `/api/sessions/:sessionId` | session info |
| POST | `/api/sessions/:sessionId/prompt` | `{text}` |
| POST | `/api/sessions/:sessionId/abort` | abort current run |
| DELETE | `/api/sessions/:sessionId` | dispose + delete |

### Pi management (Phase 9)

| Method | Path | Description |
|---|---|---|
| GET | `/api/sessions/:id/capabilities` | model, thinking, tools, skills, extensions, prompts |
| GET | `/api/workspaces/:id/models` | provider model catalog (auth-filtered) |
| POST | `/api/sessions/:id/model` | `{model: "provider/id"}` |
| POST | `/api/sessions/:id/thinking` | `{level: off\|minimal\|low\|medium\|high\|xhigh\|max}` |
| POST | `/api/sessions/:id/compact` | compact context |

## WebSocket — `/ws`

One connection multiplexes everything. Two message shapes:

**Client → server (mutations):**
```json
{ "id": "<request-id>", "type": "session.prompt", "payload": { "sessionId": "...", "text": "..." } }
```
Command types: `session.create`, `session.prompt`, `session.abort`,
`session.subscribe`, `session.unsubscribe`, `session.replay`, `health.ping`.
Request ids are deduplicated server-side (60s) for idempotency after
reconnect.

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
  non-holders when enforcement is on (`PI_CONTROL_ENFORCE_LEASES=1`).

Event types (scope): `session.created` (server), `session.state`,
`user.message`, `assistant.start|delta|end`, `thinking.start|delta|end`,
`tool.start|update|end|error`, `model.updated`, `usage.updated`,
`session.error`, `session.closed` (session), `workspace.created|state|error`
(workspace), `agent.state|health`, `process.started|output|exited`
(workspace), `project.created`, `sandbox.status|prepare|selftest` (server).

## Agent protocol (server ↔ workspace agent)

Not browser-facing; summarized in
[`docs/architecture/workspace-agent.md`](docs/architecture/workspace-agent.md).
Transport: server connects OUT to `ws://127.0.0.1:<hostPort>` with
`Authorization: Bearer <per-sandbox-token>`.
