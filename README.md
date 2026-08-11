# Vocs Pi Control

**Local-first web control plane for the Pi coding agent.**

Vocs Pi Control is a secure operating environment for coding agents. It
manages projects, isolated workspaces, Pi sessions, files, Git, terminals,
processes, tasks and observability — with rootless Podman as the sandbox
runtime and a deny-by-default host filesystem.

> **Status: Phase 3 complete (real Pi SDK running inside rootless sandboxes,
> verified on Windows 11 + WSL).** The authoritative specification is
> [`docs/pi-control-implementation-plan.md`](docs/pi-control-implementation-plan.md).
> Progress: [`TODO.md`](TODO.md).

## Security model in one sentence

> Pi Control owns rootless Podman; every explicitly added workspace owns one
> isolated container; multiple Pi sessions may collaborate inside that
> workspace; independent file work gets a new Git worktree/workspace/container;
> agents never receive host-wide filesystem or container-runtime control.

## Quick start

```bash
pnpm install
pnpm dev
```

Then open http://127.0.0.1:5173

- Sessions created in the UI use the **MockPiDriver** (no provider calls —
  useful for UI development and tests).
- **Real Pi sessions** live inside a workspace sandbox (see below).

### Full flow: real Pi inside a sandbox

```bash
# 1. Prepare the sandbox runtime (first run creates/starts the WSL/VM machine)
curl -X POST http://127.0.0.1:5174/api/sandbox/prepare
curl -X POST http://127.0.0.1:5174/api/sandbox/self-test      # isolation proof

# 2. Add a project + workspace (folder → rootless container)
curl -X POST http://127.0.0.1:5174/api/projects \
  -H 'content-type: application/json' -d '{"name":"my-app","hostRootPath":"C:/Projects/my-app"}'
curl -X POST http://127.0.0.1:5174/api/projects/<id>/workspaces \
  -H 'content-type: application/json' -d '{"name":"main","hostPath":"C:/Projects/my-app"}'
curl -X POST http://127.0.0.1:5174/api/workspaces/<id>/start

# 3. Create a REAL Pi session inside the container (pi SDK runs in the sandbox)
curl -X POST http://127.0.0.1:5174/api/workspaces/<id>/sessions \
  -H 'content-type: application/json' -d '{"title":"My session"}'

# 4. Prompt it (streaming arrives over the WebSocket protocol)
curl -X POST http://127.0.0.1:5174/api/sessions/<sessionId>/prompt \
  -H 'content-type: application/json' -d '{"text":"List /workspace"}'
```

Provider credentials: set the relevant API keys in the control-server
environment (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, …).
The server forwards them to the workspace agent at connect time (V1
boundary — see [`docs/security/threat-model.md`](docs/security/threat-model.md)).

## Monorepo layout

```text
apps/
  server/            control server: Fastify, WebSocket hub, SQLite,
                     sandbox manager, agent connections, session routing
  web/               React/Vite frontend (browser talks only to the control server)
  workspace-agent/   long-lived agent that runs INSIDE each sandbox:
                     Pi sessions (EmbeddedPiDriver), processes, exec
packages/
  protocol/          realtime protocol: EventEnvelope, ClientCommand,
                     agent protocol, typed payloads
  pi-driver/         PiSessionDriver interface + MockPiDriver + EmbeddedPiDriver
  sandbox/           SandboxRuntime interface + MockSandboxRuntime +
                     RootlessPodmanRuntime (+ path translation, arg builder,
                     security self-test)
  database/          Drizzle schema + SQLite migrations (control-plane metadata only)
  shared/            id/time utilities
  test-utils/        shared test helpers
images/base/         base image: Node 22, Git, pi SDK (pinned), workspace agent
docs/
  pi-control-implementation-plan.md   the authoritative plan (v1.0)
  api/               REST + WebSocket protocol reference
  architecture/      overview, sandbox, workspace-agent, sessions
  security/          threat model, sandbox policy
  adr/               0001–0010 architecture decision records
  operations.md      build/run/verify workflow
```

## Scripts

| Command            | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `pnpm dev`         | run server (5174) + web (5173) concurrently |
| `pnpm image:base`  | bundle workspace agent + build base image |
| `pnpm typecheck`   | strict TS across all packages             |
| `pnpm test`        | vitest unit tests                         |
| `pnpm build`       | build all packages/apps                   |
| `pnpm db:generate` | generate SQLite migration from Drizzle schema |

## Configuration (server)

| Env var                    | Default                          |
| -------------------------- | -------------------------------- |
| `PI_CONTROL_HOST`          | `127.0.0.1` (loopback only)      |
| `PI_CONTROL_PORT`          | `5174`                           |
| `PI_CONTROL_DATA_DIR`      | `~/.pi-control`                  |
| `PI_CONTROL_DB_PATH`       | `<dataDir>/pi-control.db`        |
| `PI_CONTROL_LOG_LEVEL`     | `info`                           |
| `PI_CONTROL_RUNTIME`       | `auto` (`mock`\|`podman`\|`auto`) |
| `PI_CONTROL_PODMAN_MACHINE`| `pi-control`                     |
| `PI_CONTROL_BASE_IMAGE`    | `pi-control/base:local`          |
| `PI_CONTROL_PI_DRIVER`     | `embedded` (`mock`\|`embedded`)  |
| `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, … | forwarded to agents (V1) |

## Roadmap

Tracked in [TODO.md](TODO.md) against the plan's phases (0–17) and MVP
definition (plan §55). Completed: Phase 0 foundation, Phase 1 Podman runtime,
Phase 2 workspace agent, Phase 3 real Pi integration. Next: Phase 4 reconnect
hardening, Phase 5 projects/workspaces/sessions UI.

## Security notes

- The server binds `127.0.0.1` only.
- Sandboxing: rootless Podman, workspace-per-container, no runtime sockets,
  no host mounts beyond the workspace, resource limits, loopback-only ports.
  See [`docs/security/threat-model.md`](docs/security/threat-model.md) and the
  self-test (`POST /api/sandbox/self-test`).
- The mock driver provides **no isolation** — it exists to build plumbing.
  `PI_CONTROL_RUNTIME=mock` is explicit only.
