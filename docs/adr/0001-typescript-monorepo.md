# ADR-0001: TypeScript pnpm monorepo

- Status: accepted
- Date: 2026-08-11

## Context

Pi Control spans a control server, a browser frontend, a workspace agent and
several shared packages (protocol, Pi driver, sandbox, database). We need one
repository that type-checks strictly, shares code without copy-paste, and
stays fast to develop.

## Decision

- pnpm workspaces (`apps/*`, `packages/*`).
- One strict TypeScript base config (`tsconfig.base.json`): `strict`,
  `noUncheckedIndexedAccess`, ES2022, `moduleResolution: "bundler"`.
- Internal packages are **source-linked**: package `exports` point directly at
  `src/index.ts`; Vite and tsx consume TypeScript sources, so there is no
  build step in development. Production packaging is deferred until it is
  needed.
- Node >= 22 (current Pi-supported LTS/runtime; re-check against upstream Pi).
- Vitest for unit tests; Playwright added in a later phase for E2E.

## Consequences

- Fast iteration, no stale build artifacts between packages.
- Internal packages must keep TypeScript-clean sources; `pnpm typecheck`
  enforces this in CI.
- Bundlers/loaders must be TS-aware (Vite and tsx already are).
