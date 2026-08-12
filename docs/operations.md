# Operations Guide

Build, run, and verify Vocs Pi Control locally.

## Prerequisites

- Node.js ≥ 22.19 (pi SDK requirement)
- pnpm ≥ 11
- For sandboxed workspaces: Podman
  - Windows: `winget install Redhat.Podman` (WSL 2 required)
  - macOS: `brew install podman`
  - Ubuntu: `sudo apt install podman`
- A provider API key in the server environment for real Pi sessions
  (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, …)

## Development

```bash
pnpm install
pnpm dev          # server on 127.0.0.1:5174, web on 127.0.0.1:5173
```

Typecheck and tests:

```bash
pnpm typecheck
pnpm test
```

## Base image

The base image contains Node 22, Git, the pinned Pi SDK
(`@earendil-works/pi-coding-agent@0.84.1` under `/opt/pi-control/node_modules`)
and the bundled workspace agent (CJS — `ws` requires CJS; pi is loaded at
runtime via NODE_PATH walk).

```bash
pnpm image:base    # bundles the agent, then podman build
```

## First sandbox run

```bash
curl -X POST http://127.0.0.1:5174/api/sandbox/prepare    # machine create/start (slow first time)
curl -X POST http://127.0.0.1:5174/api/sandbox/self-test   # 8 isolation checks
```

## Workspace + real Pi session

See README "Full flow". The container runs the workspace agent as its
entrypoint; the control server connects to it through a loopback-forwarded
port and forwards provider credentials at hello.

## Verification checklist (after changes)

1. `pnpm typecheck` + `pnpm test`
2. Sandbox self-test passes (isolation: host home absent, sockets absent,
   /workspace RW)
3. Workspace create → start → agent `connected`
4. Workspace session create → prompt → streaming envelopes
   (`thinking.delta`, `tool.start/end`, `assistant.delta`, `session.state
   idle`)
5. Process spawn survives an agent/control-server disconnect; kill works
6. Native session resume after workspace restart

## Server restart policy (issue #15)

Restarting the control server **stops every sandbox** (deterministic
stop-on-boot). Supervised processes and terminals therefore do NOT survive
a full server restart; they do survive transient control-server
*disconnects* while the server process stays alive, because the workspace
agent owns them and reconnects with backoff. Native Pi session transcripts
persist in the `/state` volumes and are resumed on the next prompt
(auto-recovery).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `/api/health` shows runtime `mock` | podman not on the server's PATH or `PI_CONTROL_RUNTIME=mock`; restart the server from a shell with podman on PATH |
| Agent stuck `connecting` | workspace container not running; agent port forward missing (check `podman port <container>`); agent crashed (check `podman logs <container>`) |
| `Pi SDK unavailable: Cannot locate package` | image built without pi (rebuild via `pnpm image:base`); bundle/`NODE_PATH` mismatch |
| `No API key found` in agent logs | provider key missing in the server environment at the time the agent connected (credentials are forwarded at hello) |
| WS `close 1006` | server↔agent handshake failed: token mismatch or agent bound the wrong interface (it must bind `0.0.0.0` inside the container) |
| Session prompt times out | provider unreachable from the sandbox (network egress) or the run exceeds the agent command timeout |

## Logs

- Control server: structured JSON to stdout (pino, redaction on).
- Workspace agent: JSON lines via `podman logs <container>`.
- Native Pi sessions: `/state/pi-agent/sessions/**/*.jsonl` (persistent
  volume `pi-control-<ws>-state`).
