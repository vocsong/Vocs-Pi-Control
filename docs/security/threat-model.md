# Threat Model

Phase-0 builds plumbing with mock drivers; **no isolation is claimed yet**.
This document defines the target model that Podman integration (Phase 1+)
must implement and tests must verify.

## Adversaries and assumptions

Assume:

- prompts can be malicious (prompt injection);
- repository contents can contain prompt injection;
- package scripts can execute code;
- Pi extensions/packages can execute code;
- agent-written shell commands can be dangerous;
- development dependencies may be compromised;
- the agent may make mistakes;
- browser pages may be malicious (the browser is not a trust anchor);
- users may accidentally approve unsafe operations.

## Protected assets

1. Host files outside explicitly added workspaces.
2. Host SSH/cloud credentials and credential stores.
3. Podman/Docker runtime control (socket).
4. Other workspaces and their data.
5. LLM provider API credentials.
6. Browser session/authentication.
7. Private source code.
8. System stability and resources.

## Attack paths and controls

| Path | Control |
|---|---|
| Agent reads `~/.ssh`, `~/.aws`, home, other projects | deny-by-default mounts; workspace-per-container; application path containment (Phase 6); security self-test proves absence (plan §48.3) |
| Agent controls containers | never mount runtime sockets (plan §43); agent has no useful Podman connection |
| Agent escapes to host kernel | rootless Podman, no privileged, no host namespaces, no devices, no-new-privileges, unprivileged container user |
| Agent exhausts host resources | bounded CPU/memory/PIDs per workspace (plan §17) |
| Agent exfiltrates provider secrets | minimal credential injection; scrubbed child environments; credential broker later (ADR-0010) |
| Malicious browser page attacks server | loopback binding; Host/Origin validation; CSRF defense; HttpOnly cookie; SameSite=Strict; security headers (ADR-0008) |
| Network exposure of Pi Control | no public binding by default; remote access only via private tunnels (plan §46) |
| Replay/reconnect confusion | seq-based bounded replay; idempotent commands with request ids (ADR-0007) |
| Data loss on rebuild | persistent `/state` volume; native Pi sessions are source of truth (ADR-0005) |

## V1 secret exposure boundary (implemented, documented, not hidden)

Implemented as of Phase 3: the control server owns provider credential env
vars (read from its own environment: `ANTHROPIC_API_KEY`,
`DEEPSEEK_API_KEY`, …) and forwards them to the workspace agent inside the
`agent.hello` payload at connect time. The agent applies them to its
process environment; `ModelRuntime` resolves them; child shells spawned by
the bash tool **inherit** them. This is a known boundary with a clear
mitigation path: the credential broker (Phase 7+, ADR-0010) will move to a
scoped provider-request flow so general shell commands never receive
long-lived provider secrets. The per-sandbox agent token is separate from
provider credentials and only authenticates the agent endpoint.

## Verification

- Unit tests: path containment, protocol validation, permission checks.
- Integration (Phase 1+): sandbox isolation tests (plan §48.3) — host home
  read fails, `~/.ssh` absent, socket absent, `/workspace` RW works.
- Every release re-runs isolation tests (plan §60).
