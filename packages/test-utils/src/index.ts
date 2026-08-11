/**
 * Test helpers shared across packages and apps.
 */

export { MockPiDriver } from "@pi-control/pi-driver/mock";
export { MockSandboxRuntime } from "@pi-control/sandbox/mock";
import { sleep } from "@pi-control/shared";

export { sleep };

/** Poll `predicate` until it returns a truthy value or the timeout expires. */
export async function waitFor<T>(
  predicate: () => T | undefined | null | false,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const { timeoutMs = 4000, intervalMs = 10, label = "condition" } = options;
  const start = Date.now();
  for (;;) {
    const result = predicate();
    if (result) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out: ${label}`);
    }
    await sleep(intervalMs);
  }
}

/** Collect events from an async iterable into an array (bounded). */
export async function collectAsync<T>(iterable: AsyncIterable<T>, limit = 100): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
