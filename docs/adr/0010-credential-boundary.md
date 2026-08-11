# ADR-0010: Credential boundary — never mounted, never forwarded by default

- Status: accepted
- Date: 2026-08-11

## Context

Host credentials (`~/.ssh`, `~/.aws`, cloud configs, credential helpers,
password stores) are primary attack targets for prompt-injected or
compromised agents (plan §15, §61).

## Decision

- **Never mounted by default**: no `~/.ssh`, `~/.aws`, `~/.azure`,
  `~/.config/gcloud`, host credential helpers, browser cookies, or host
  password stores inside sandboxes.
- **No runtime sockets**: Podman/Docker sockets are never mounted into
  workspaces (plan §43).
- LLM provider credentials (V1): the control server owns credential
  configuration and injects only the minimal provider credential material
  required by the Pi runtime; child shell environments are scrubbed where
  possible. This V1 boundary is documented in the threat model.
- Git pushes: control-plane credential broker performs authenticated pushes
  host-side when auth is required (Phase 7+); raw SSH private keys are not
  handed to Pi.
- Every exception requires an explicit `security_grants` record and visible
  workspace security UI (plan §45).

## Implementation notes (Phase 3)

- Credential env vars are forwarded from the control server to the agent
  inside `agent.hello.env` at connect time (only the known provider key
  names); the agent applies them to its process environment.
- `ModelRuntime.create()` resolves them via its env-var priority; the bash
  tool's children inherit them (documented V1 boundary).
- The per-sandbox agent token is unrelated to provider credentials and is
  never exposed to Pi sessions.

## Consequences

- Agents can develop (npm, pip, git read, tests) with zero host credentials.
- Push/authenticated flows need a broker — an explicit future work item, not
  silently granted.
- Security self-tests must prove credential paths are absent (plan §48.3).
