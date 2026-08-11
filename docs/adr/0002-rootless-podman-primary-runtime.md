# ADR-0002: Rootless Podman is the primary sandbox runtime

- Status: accepted
- Date: 2026-08-11

## Context

Pi agents must be prevented from accessing host files outside explicitly added
workspaces, host credentials, and container-runtime control. Containers are
the chosen isolation boundary; the implementation plan fixes rootless Podman
as the primary runtime (plan §0, §3.2).

## Decision

- V1 sandboxing uses **rootless Podman** containers only.
- On macOS/Windows, Pi Control manages a dedicated **Podman Machine**
  (`pi-control`) rather than mutating the user's other machines.
- No rootful fallback without an explicit user decision and an ADR.
- All container operations flow through the `SandboxRuntime` adapter
  (`packages/sandbox`); nothing else shells out to `podman`.
- `MockSandboxRuntime` stands in for unit/UI tests.

## Consequences

- Rootless Podman limits the blast radius of a compromised container
  (no root on host, user-namespace remapping).
- macOS/Windows incur a VM layer; onboarding must detect/install/start it.
- Podman Machine mount semantics vary by provider (WSL vs VM) — path
  translation is centralized inside the Podman adapter (Phase 1).
