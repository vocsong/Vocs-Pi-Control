# ADR-0003: A workspace is the container boundary

- Status: accepted
- Date: 2026-08-11

## Context

Pi Control must decide how filesystem isolation maps to containers. Too many
containers (per prompt) wastes resources; too few (all projects in one)
breaks isolation (plan §5).

## Decision

- **One workspace owns exactly one primary sandbox container.**
- A workspace is the security boundary: the container receives exactly one
  explicit host bind mount (the workspace folder) plus named volumes for
  private state, plus optional explicitly granted extras.
- Multiple Pi sessions share one workspace/container deliberately and see the
  same `/workspace` (plan §13).
- Independent file work uses Git worktrees → new workspace → new container.

## Consequences

- Dependency installs, dev servers, terminals and Git state are shared per
  workspace — matching developer expectations.
- File-conflict risk between cooperating sessions in one workspace exists;
  the UI must disclose it (plan §13.2).
- Container lifecycle is long-lived relative to prompts; idle policy governs
  stopping (plan §18.2).
