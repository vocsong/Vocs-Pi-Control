/**
 * pi-control-workspace-agent (skeleton — Phase 2 target).
 *
 * In production this long-lived service runs INSIDE each workspace sandbox
 * container (plan §11, ADR-0006). Responsibilities (Phase 2+):
 *   - authenticated connection to the control server (per-sandbox secret);
 *   - start/resume Pi sessions via the Pi driver;
 *   - PTY/terminal ownership and long-running process supervision;
 *   - health/resource reporting and reconnect semantics.
 *
 * Phase 0 ships only the package skeleton so the monorepo layout is complete.
 */

import { newId } from "@pi-control/shared";

const agentId = newId("wa");

// eslint-disable-next-line no-console
console.log(`[workspace-agent] ${agentId} skeleton online (Phase 0 — full agent lands in Phase 2)`);
