# ADR-0009: SQLite as the control-plane database

- Status: accepted
- Date: 2026-08-11

## Context

Pi Control needs durable metadata (machines, projects, workspaces, sessions,
tasks, traces, grants) with migrations from the first commit. It must not
become a distributed system before local lifecycle is robust (plan §24, §60).

## Decision

- **SQLite** via Drizzle ORM (`packages/database`), WAL mode, foreign keys
  on, busy timeout.
- The database stores **control-plane metadata only** — never Pi transcripts
  (ADR-0005).
- Initial tables match plan §24: machines, projects, workspaces, sandboxes,
  sessions, tasks, processes, terminals, artifacts, settings, plugins,
  plugin_permissions, traces, event_checkpoints, security_grants.
- Migrations are generated with drizzle-kit and applied automatically at
  server startup.

## Consequences

- Zero-infrastructure local operation; trivial backups (one file).
- Concurrency is single-process; the control server is the only writer.
- Large-scale remote-machine support later can migrate per-machine metadata
  without protocol changes.
