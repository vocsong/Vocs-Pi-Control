import { describe, expect, it } from "vitest";
import { MockPiDriver } from "./mock.js";
import type { PiDriverEvent } from "./index.js";
import { sleep } from "@pi-control/shared";

function collect(
  driver: MockPiDriver,
  sessionId: string,
): { events: PiDriverEvent[]; waitFor: (predicate: (events: PiDriverEvent[]) => boolean, timeoutMs?: number) => Promise<void> } {
  const events: PiDriverEvent[] = [];
  driver.subscribe(sessionId, (e) => events.push(e));
  const waitFor = async (
    predicate: (events: PiDriverEvent[]) => boolean,
    timeoutMs = 4000,
  ): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate(events)) return;
      await sleep(5);
    }
    throw new Error(
      `Timed out waiting for events; got ${events.length}: ${events.map((e) => e.type).join(",")}`,
    );
  };
  return { events, waitFor };
}

describe("MockPiDriver", () => {
  it("creates an idle session and emits a scripted prompt cycle", async () => {
    const driver = new MockPiDriver({ speedMs: 1 });
    const handle = await driver.create({ title: "t" });
    expect(handle.status).toBe("idle");

    const { events, waitFor } = collect(driver, handle.id);
    void driver.prompt(handle.id, { text: "hello mock" });
    await waitFor((ev) => ev.some((e) => e.type === "assistant.end"));

    const types = events.map((e) => e.type);
    expect(types).toContain("user.message");
    expect(types).toContain("thinking.start");
    expect(types).toContain("tool.start");
    expect(types).toContain("tool.end");
    expect(types).toContain("assistant.start");
    expect(types).toContain("assistant.end");
    expect(types).toContain("usage.updated");
    expect(types).toContain("state");

    const firstState = events.findIndex((e) => e.type === "state");
    const lastState = events.findLastIndex((e) => e.type === "state");
    expect(firstState).toBeLessThan(lastState);

    const snapshot = await driver.getSnapshot(handle.id);
    expect(snapshot.handle.status).toBe("idle");
  });

  it("honors abort mid-stream", async () => {
    const driver = new MockPiDriver({ speedMs: 20 });
    const handle = await driver.create();

    const { events, waitFor } = collect(driver, handle.id);
    void driver.prompt(handle.id, { text: "long task" });
    await waitFor((ev) => ev.some((e) => e.type === "thinking.start"));
    await driver.abort(handle.id);
    await waitFor((ev) => ev.some((e) => e.type === "closed"));

    const types = events.map((e) => e.type);
    expect(types).toContain("closed");
    const snapshot = await driver.getSnapshot(handle.id);
    expect(["stopped", "idle"]).toContain(snapshot.handle.status);
  });

  it("queues a second prompt until the first finishes", async () => {
    const driver = new MockPiDriver({ speedMs: 1 });
    const handle = await driver.create();

    const { events, waitFor } = collect(driver, handle.id);
    const first = driver.prompt(handle.id, { text: "one" });
    const second = driver.prompt(handle.id, { text: "two" });
    await Promise.all([first, second]);
    await waitFor((ev) => ev.filter((e) => e.type === "user.message").length === 2);

    const userMessages = events.filter((e) => e.type === "user.message");
    expect(userMessages).toHaveLength(2);
    const snapshot = await driver.getSnapshot(handle.id);
    expect(snapshot.handle.status).toBe("idle");
  });
});
