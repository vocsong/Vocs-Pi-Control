# ADR-0008: Localhost security model for the control plane

- Status: accepted
- Date: 2026-08-11

## Context

The control server holds sandbox lifecycle power and credential material.
Exposing it publicly without a separately designed transport would be
catastrophic (plan §42, §46).

## Decision

- The server binds `127.0.0.1` only by default. `0.0.0.0` requires explicit
  configuration.
- Browser authentication (Phase 2): random one-time bootstrap token exchanged
  for an HttpOnly session cookie; `SameSite=Strict`; validation of `Host` and
  `Origin` for mutations and WebSocket upgrades.
- Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  no-referrer`, CSP, `frame-ancestors 'none'`, `Cache-Control: no-store`.
- Structured logs with redaction; no prompts/tool outputs/secrets by default.
- No PIN-as-internet-security scheme (plan §46).

## Consequences

- The browser → server hop is trusted-but-authenticated on loopback; real
  remote access later goes through Tailscale/WireGuard-style tunnels, not
  port exposure.
- Phase 2 must implement bootstrap token + cookie flow before the server is
  usable beyond localhost demo mode.
