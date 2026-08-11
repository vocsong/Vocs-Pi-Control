import { describe, expect, it } from "vitest";
import { LeaseManager } from "./leases.js";

describe("LeaseManager", () => {
  it("grants one holder per session; second take is rejected", () => {
    const leases = new LeaseManager({ ttlMs: 30_000 });
    const first = leases.take("s1", "client_a");
    expect(first.holder).toBe("client_a");

    const second = leases.take("s1", "client_b");
    expect(second.holder).toBe("client_a");

    // Force takeover works explicitly.
    const forced = leases.take("s1", "client_b", true);
    expect(forced.holder).toBe("client_b");
  });

  it("heartbeat renews the holder's lease and takes a free one", () => {
    const leases = new LeaseManager({ ttlMs: 30_000 });
    const lease = leases.heartbeat("s1", "client_a");
    expect(lease?.holder).toBe("client_a");
    expect(lease?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("expires leases after the TTL", () => {
    const leases = new LeaseManager({ ttlMs: 50 });
    leases.take("s1", "client_a");
    const stale = leases.status("s1");
    expect(stale.holder).toBe("client_a");
    // Simulate expiry: a take after TTL succeeds.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const taken = leases.take("s1", "client_b");
        expect(taken.holder).toBe("client_b");
        resolve();
      }, 80);
    });
  });

  it("release clears the holder; releaseAllFor frees every lease", () => {
    const leases = new LeaseManager();
    leases.take("s1", "client_a");
    leases.take("s2", "client_a");
    leases.take("s3", "client_b");

    const released = leases.releaseAllFor("client_a");
    expect(released.sort()).toEqual(["s1", "s2"]);
    expect(leases.status("s1").holder).toBeNull();
    expect(leases.status("s3").holder).toBe("client_b");
  });

  it("enforces prompts only when configured", () => {
    const advisory = new LeaseManager({ enforcePrompts: false });
    advisory.take("s1", "client_a");
    expect(advisory.mayPrompt("s1", "client_b").allowed).toBe(true);

    const enforced = new LeaseManager({ enforcePrompts: true });
    enforced.take("s1", "client_a");
    expect(enforced.mayPrompt("s1", "client_b").allowed).toBe(false);
    expect(enforced.mayPrompt("s1", "client_a").allowed).toBe(true);
    // Free lease: anyone may prompt (and implicitly become primary).
    expect(enforced.mayPrompt("s2", "client_b").allowed).toBe(true);
  });
});
