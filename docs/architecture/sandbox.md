# Sandbox Architecture

See also [`../security/sandbox-policy.md`](../security/sandbox-policy.md) for
the non-negotiable rules and [`../security/threat-model.md`](../security/threat-model.md).

## Runtime abstraction

`packages/sandbox` defines `SandboxRuntime` (detect/prepare, create/start/
stop/remove workspace, inspect, exec, logs, build/pull image, list ports).
V1 implementation is the Podman adapter (Phase 1); tests use
`MockSandboxRuntime`. Nothing outside this package shells out to `podman`.

## Container layout (plan §9)

```text
/
├── workspace/    explicit host bind mount (the only host path by default)
├── home/pi/      named volume — private persistent sandbox home
├── state/        named volume — Pi/agent persistent state, sessions
├── cache/        named volume — npm/pip/tool caches
├── tools/        named volume — global tool prefix
├── tmp/          tmpfs (ephemeral)
└── run/          tmpfs (ephemeral runtime state)
```

- The host's real home is never mounted (ADR-0010).
- Pi config inside the sandbox: `PI_CODING_AGENT_DIR=/state/pi-agent`,
  `PI_CODING_AGENT_SESSION_DIR=/state/pi-sessions` (verify against current
  upstream Pi env names at implementation time).

## Standard profile (default)

Rootless; no privileged; no Podman/Docker socket; no host network/PID/IPC;
no host devices; no extra capabilities; `no-new-privileges`; explicit
workspace bind mount only; private HOME; bounded memory/CPU/PIDs; only
explicit loopback-forwarded ports; unprivileged container user; no host
credentials. `restricted` and `trusted` profiles are described in plan §8;
`trusted` is explicit opt-in only and never auto-promoted.

## Development environment behavior

- PATH order: `/workspace/node_modules/.bin`, `/workspace/.venv/bin`,
  `/tools/bin`, `/tools/npm/bin`, system paths.
- `NPM_CONFIG_PREFIX=/tools/npm`, `NPM_CONFIG_CACHE=/cache/npm`,
  `PIP_CACHE_DIR=/cache/pip` — host global prefixes are never modified.
- OS packages: no host apt/brew/winget for agents; environment profiles
  (`node`, `python`, `node-python`, `universal`, …) are rebuilt via images
  while preserving `/workspace` and persistent volumes.

## Dev-port exposure (per-sandbox slots)

Dev servers started inside a sandbox are reachable on the host loopback
through a published port range (plan §16.2):

- **Container side** is always `43100–43119` — the agent's port discovery
  (`/proc/net/tcp`) and the Processes tab guidance use this range.
- **Host side** shifts by a per-sandbox **slot**: slot `k` publishes
  `43100 + k·20` … `43119 + k·20` (loopback only, `DEV_PORT_SLOTS = 10`
  slots → 43100–43299). The slot is allocated at container creation
  (lowest free across all sandbox rows) and **re-allocated at rebuild** so
  a rebuild never collides with a running sandbox holding the same range.
- The slot is persisted in the sandbox record's `configJson.devHostStart`
  and exposed on `SandboxInfo` as `devHostStart`/`devHostEnd`. The ports
  API maps each listening container port `p` to
  `http://127.0.0.1:<devHostStart + (p − 43100)>`.
- Legacy sandboxes created before slotting default to slot 0 (43100–43119);
  a rebuild re-slots them automatically. Start legacy sandboxes one at a
  time until rebuilt — two containers cannot publish the same host range.

## Lifecycle

`missing → building → stopped → starting → running → stopping → stopped`,
any state → `error`. Containers are long-lived relative to prompts; idle
policy never stops a workspace with active sessions/processes (plan §18).
Environment rebuild preserves `/workspace` + volumes and resumes native
sessions from `/state`.

## Podman host setup

- Linux: rootless Podman + subordinate UID/GID config; diagnostics, never
  silent sudo.
- macOS: dedicated Podman Machine `pi-control` (create/start/verify mount).
- Windows: Podman Machine with WSL provider by default; bind-mount test
  before workspace creation; all path translation lives in the Podman
  adapter.
- First-run self-test: container launch, `/workspace` write, host home
  absent, socket absent, non-privileged properties, loopback port forward
  (plan §50).
