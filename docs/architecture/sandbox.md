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
