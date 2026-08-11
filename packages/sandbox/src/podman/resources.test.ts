import { describe, expect, it } from "vitest";
import { defaultResources } from "./resources.js";

describe("defaultResources", () => {
  it("picks conservative defaults within plan §17 ranges", () => {
    const r = defaultResources({ cpus: 16, memTotalBytes: 32 * 1024 ** 3 });
    expect(r.cpus).toBeGreaterThanOrEqual(2);
    expect(r.cpus).toBeLessThanOrEqual(4);
    expect(r.memoryBytes).toBeGreaterThanOrEqual(4 * 1024 ** 3);
    expect(r.memoryBytes).toBeLessThanOrEqual(8 * 1024 ** 3);
    expect(r.pidLimit).toBeGreaterThan(0);
  });

  it("scales down for small hosts but stays within range", () => {
    const r = defaultResources({ cpus: 2, memTotalBytes: 8 * 1024 ** 3 });
    expect(r.cpus).toBeGreaterThanOrEqual(1);
    expect(r.memoryBytes).toBeLessThanOrEqual(8 * 1024 ** 3);
  });

  it("does not exceed the max even on huge hosts", () => {
    const r = defaultResources({ cpus: 128, memTotalBytes: 1024 * 1024 ** 3 });
    expect(r.cpus).toBeLessThanOrEqual(4);
    expect(r.memoryBytes).toBeLessThanOrEqual(8 * 1024 ** 3);
  });
});
