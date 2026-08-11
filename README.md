# Vocs Pi Control

**Local-first web control plane for the Pi coding agent.**

Vocs Pi Control is a secure operating environment for coding agents. It
manages projects, isolated workspaces, Pi sessions, files, Git, terminals,
processes, tasks and observability — with rootless Podman as the sandbox
runtime and a deny-by-default host filesystem.

> **Status: Phase 1 complete (Podman runtime verified on Windows).** The
> authoritative specification is
> [`docs/pi-control-implementation-plan.md`](docs/pi-control-implementation-plan.md).

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

- Create a session from the sidebar and prompt it: the **MockPiDriver**
  streams thinking, a tool call, and an assistant reply through the full
  browser → server → driver stack (real Pi SDK lands in Phase 3).
- Sandbox runtime is auto-detected: rootless Podman when available, mock
  otherwise. `PI_CONTROL_RUNTIME=mock|podman|auto` overrides.

### Sandbox (Phase 1)

On first use with Podman (macOS/Windows), prepare the dedicated machine:

```bash
curl -X POST http://127.0.0.1:5174/api/sandbox/prepare   # creates/starts pi-control machine
curl -X POST http://127.0.0.1:5174/api/sandbox/self-test  # isolation proof
```

Add a project and workspace (folder → container):

```bash
curl -X POST http://127.0.0.1:5174/api/projects -H 'content-type: application/json' \
  -d '{"name":"my-app","hostRootPath":"C:/Projects/my-app"}'
curl -X POST http://127.0.0.1:5174/api/projects/<id>/workspaces -H 'content-type: application/json' \
  -d '{"name":"main","hostPath":"C:/Projects/my-app"}'
curl -X POST http://127.0.0.1:5174/api/workspaces/<id>/start
```

The folder mounts as `/workspace` in a rootless container with private
volumes (`/home/pi`, `/state`, `/cache`, `/tools`), tmpfs `/tmp` + `/run`,
resource limits, no sockets, no host home, no host network.

## Monorepo layout

```text
apps/
  server/            control server: Fastify, WebSocket hub, SQLite, session manager
  web/               React/Vite frontend (browser connects only to the control server)
  workspace-agent/   skeleton — long-lived agent that runs inside each sandbox (Phase 2)
packages/
  protocol/          realtime protocol: EventEnvelope, ClientCommand, typed payloads
  pi-driver/         PiSessionDriver interface + MockPiDriver
  sandbox/           SandboxRuntime interface + MockSandboxRuntime
  database/          Drizzle schema + SQLite migrations (control-plane metadata only)
  shared/            id/time utilities
  test-utils/        shared test helpers
docs/
  pi-control-implementation-plan.md   the authoritative plan (v1.0)
  architecture/      overview, sandbox, workspace-agent
  security/          threat model, sandbox policy
  adr/               0001–0010 architecture decision records
```

## Scripts

| Command            | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `pnpm dev`         | run server (5174) + web (5173) concurrently |
| `pnpm typecheck`   | strict TS across all packages             |
| `pnpm test`        | vitest unit tests                         |
| `pnpm build`       | build all packages/apps                   |
| `pnpm db:generate` | generate SQLite migration from Drizzle schema |

## Configuration (server)

| Env var               | Default                  |
| --------------------- | ------------------------ |
| `PI_CONTROL_HOST`     | `127.0.0.1` (loopback only) |
| `PI_CONTROL_PORT`     | `5174`                   |
| `PI_CONTROL_DATA_DIR` | `~/.pi-control`          |
| `PI_CONTROL_DB_PATH`  | `<dataDir>/pi-control.db` |
| `PI_CONTROL_LOG_LEVEL`| `info`                   |

## Roadmap

Tracked in [TODO.md](TODO.md) against the plan's phases (0–17) and MVP
definition (plan §55). Key next milestones: Phase 1 Podman runtime bootstrap,
Phase 2 workspace agent, Phase 3 real Pi SDK driver.

## Security notes

- The server binds `127.0.0.1` only.
- Phase 1+ sandboxing: rootless Podman, workspace-per-container, no runtime
  sockets, no host mounts beyond the workspace, resource limits, explicit
  loopback-only ports. See
  [`docs/security/threat-model.md`](docs/security/threat-model.md) and the
  self-test (`POST /api/sandbox/self-test`) for the isolation proof.
- The mock driver provides **no isolation** — it exists to build plumbing.
  `PI_CONTROL_RUNTIME=mock` is explicit only.
