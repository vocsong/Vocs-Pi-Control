/**
 * Runtime selection at server startup.
 *
 * PI_CONTROL_RUNTIME=mock|podman|auto (default auto):
 *   - auto: use RootlessPodmanRuntime whenever the podman CLI is detected;
 *     fall back to the mock runtime (no isolation) only when podman is
 *     missing. A present-but-unprepared machine is still the podman runtime
 *     — preparation is a user action, never silently skipped.
 */

import {
  RootlessPodmanRuntime,
  DEFAULT_MACHINE_NAME,
  type SandboxRuntime,
  type RuntimeDetection,
} from "@pi-control/sandbox";
import { MockSandboxRuntime } from "@pi-control/sandbox/mock";
import type { Logger } from "../logger.js";

export interface RuntimeSelection {
  runtime: SandboxRuntime;
  detection: RuntimeDetection;
  /** Human-readable reason for the selection. */
  reason: string;
}

export async function selectRuntime(logger: Logger, env: NodeJS.ProcessEnv = process.env): Promise<RuntimeSelection> {
  const mode = (env.PI_CONTROL_RUNTIME ?? "auto").toLowerCase();
  const machineName = env.PI_CONTROL_PODMAN_MACHINE ?? DEFAULT_MACHINE_NAME;

  if (mode === "mock") {
    logger.warn("PI_CONTROL_RUNTIME=mock: using mock sandbox runtime (NO container isolation)");
    return { runtime: new MockSandboxRuntime(), detection: await new MockSandboxRuntime().detect(), reason: "explicit mock" };
  }

  const podman = new RootlessPodmanRuntime({ machineName });
  const detection = await podman.detect();

  if (mode === "podman") {
    return { runtime: podman, detection, reason: "explicit podman" };
  }

  if (detection.detected) {
    return {
      runtime: podman,
      detection,
      reason: detection.rootlessAvailable
        ? "podman detected with rootless runtime"
        : "podman detected (machine preparation pending)",
    };
  }

  logger.warn({ messages: detection.messages }, "Podman not detected; falling back to mock sandbox runtime (no isolation)");
  const mock = new MockSandboxRuntime();
  return { runtime: mock, detection: await mock.detect(), reason: "podman not detected; mock fallback" };
}
