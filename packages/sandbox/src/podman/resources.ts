/**
 * Conservative default resource limits (plan §17).
 *
 * Detect host (machine) capacity and pick defaults within the plan's
 * recommended ranges: CPU 2–4, memory 4–8 GiB, bounded PIDs.
 */

import { clamp } from "@pi-control/shared";

export interface HostCapacity {
  cpus: number;
  memTotalBytes: number;
}

export interface ResourceDefaults {
  cpus: number;
  memoryBytes: number;
  pidLimit: number;
}

export const DEFAULT_PID_LIMIT = 512;
export const MIN_MEMORY_BYTES = 4 * 1024 ** 3; // 4 GiB
export const MAX_MEMORY_BYTES = 8 * 1024 ** 3; // 8 GiB
export const MIN_CPUS = 2;
export const MAX_CPUS = 4;

export function defaultResources(capacity: HostCapacity): ResourceDefaults {
  const memGiB = capacity.memTotalBytes / 1024 ** 3;
  const targetGiB = clamp(Math.floor(memGiB * 0.4), 4, 8);
  const memoryBytes = targetGiB * 1024 ** 3;
  const cpus = clamp(Math.floor(capacity.cpus / 2), MIN_CPUS, MAX_CPUS);
  return { cpus, memoryBytes, pidLimit: DEFAULT_PID_LIMIT };
}
