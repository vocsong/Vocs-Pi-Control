import { describe, expect, it, beforeEach } from "vitest";
import { THEMES, getStoredTheme, applyTheme, currentTheme } from "./themes";

// jsdom-less: provide minimal DOM stubs for the theme helpers.
class FakeClassList {
  private set = new Set<string>();
  toggle(cls: string, on: boolean): void {
    if (on) this.set.add(cls);
    else this.set.delete(cls);
  }
  contains(cls: string): boolean {
    return this.set.has(cls);
  }
}

const fakeRoot = {
  classList: new FakeClassList(),
  attributes: {} as Record<string, string>,
  setAttribute(key: string, value: string): void {
    this.attributes[key] = value;
  },
  getAttribute(key: string): string | null {
    return this.attributes[key] ?? null;
  },
};

const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).document = {
  documentElement: fakeRoot,
};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
};

beforeEach(() => {
  storage.clear();
  fakeRoot.attributes = {};
});

describe("themes", () => {
  it("registers exactly the four themes with valid classes", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["default", "neon", "glass", "holo"]);
    for (const theme of THEMES) {
      expect(theme.className).toBe(`theme-${theme.id}`);
    }
  });

  it("defaults to the core theme when nothing is stored", () => {
    expect(getStoredTheme()).toBe("default");
  });

  it("persists and applies a selected theme", () => {
    applyTheme("neon");
    expect(fakeRoot.attributes["data-theme"]).toBe("neon");
    expect(fakeRoot.classList.contains("theme-neon")).toBe(true);
    expect(fakeRoot.classList.contains("theme-default")).toBe(false);
    expect(getStoredTheme()).toBe("neon");
  });

  it("switching themes keeps exactly one theme class active", () => {
    applyTheme("glass");
    applyTheme("holo");
    let activeCount = 0;
    for (const theme of THEMES) {
      if (fakeRoot.classList.contains(theme.className)) activeCount++;
    }
    expect(activeCount).toBe(1);
    expect(fakeRoot.attributes["data-theme"]).toBe("holo");
  });

  it("ignores unknown stored values", () => {
    storage.set("pi-control.theme", "hotdog");
    expect(getStoredTheme()).toBe("default");
  });

  it("reports the current theme", () => {
    applyTheme("glass");
    expect(currentTheme()).toBe("glass");
  });
});
