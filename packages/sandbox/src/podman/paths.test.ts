import { describe, expect, it } from "vitest";
import { translateHostPath } from "./paths.js";

describe("translateHostPath", () => {
  it("passes Linux paths through unchanged", () => {
    expect(translateHostPath("/home/user/projects/app", { platform: "linux" })).toEqual({
      machinePath: "/home/user/projects/app",
    });
  });

  it("translates Windows drive paths to /mnt/<drive>", () => {
    expect(translateHostPath("C:\\Projects\\My App", { platform: "win32" })).toEqual({
      machinePath: "/mnt/c/Projects/My App",
    });
    expect(translateHostPath("d:/other", { platform: "win32" })).toEqual({
      machinePath: "/mnt/d/other",
    });
  });

  it("rejects Windows paths without a drive letter", () => {
    expect(() => translateHostPath("\\\\server\\share", { platform: "win32" })).toThrow();
  });

  it("keeps macOS paths inside the home share as-is", () => {
    const home = "/Users/pi";
    expect(translateHostPath("/Users/pi/Projects/app", { platform: "darwin", homeDir: home })).toEqual({
      machinePath: "/Users/pi/Projects/app",
    });
  });

  it("rejects macOS paths outside the default share", () => {
    expect(() =>
      translateHostPath("/Volumes/External/app", { platform: "darwin", homeDir: "/Users/pi" }),
    ).toThrow(/outside the Podman Machine default share/);
  });

  it("rejects unsupported platforms", () => {
    expect(() => translateHostPath("/x", { platform: "freebsd" })).toThrow();
  });
});
