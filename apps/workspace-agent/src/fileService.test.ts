import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileService } from "./fileService.js";

let root: string;
let fsx: FileService;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "pic-files-"));
  fsx = new FileService(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(root, "README.md"), "# Hi\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("FileService containment", () => {
  it("resolves relative paths inside the workspace", () => {
    expect(fsx.resolve("src/a.ts")).toBe(path.join(root, "src", "a.ts"));
    expect(fsx.resolve("")).toBe(root);
  });

  it("rejects absolute paths and traversal", () => {
    expect(() => fsx.resolve("/etc/passwd")).toThrow(/absolute/);
    expect(() => fsx.resolve("../outside")).toThrow(/escapes/);
    expect(() => fsx.resolve("../../etc")).toThrow(/escapes/);
  });

  it.skipIf(process.platform === "win32")("rejects symlinks pointing outside the workspace", () => {
    // Windows requires admin/developer-mode for symlinks; covered on POSIX.
    const outside = mkdtempSync(path.join(tmpdir(), "pic-outside-"));
    try {
      symlinkSync(outside, path.join(root, "evil"));
      expect(() => fsx.read("evil/secret.txt")).toThrow(/escapes/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("FileService operations", () => {
  it("lists directory entries sorted dirs-first", async () => {
    const entries = await fsx.list("");
    expect(entries.map((e) => e.name)).toEqual(["src", "README.md"]);
    expect(entries[0]?.type).toBe("dir");
  });

  it("reads and writes text files", async () => {
    const read = await fsx.read("src/a.ts");
    expect(read.content).toContain("export const a");
    expect(read.encoding).toBe("utf8");
    expect(read.truncated).toBe(false);

    await fsx.write("src/b.ts", "export const b = 2;\n");
    expect(await fsx.read("src/b.ts")).toMatchObject({ content: "export const b = 2;\n" });
  });

  it("detects binary content and returns base64", async () => {
    await fsx.write("img.bin", Buffer.from([0, 1, 2, 255]).toString("base64"), "base64");
    const read = await fsx.read("img.bin");
    expect(read.encoding).toBe("base64");
  });

  it("truncates oversized reads", async () => {
    writeFileSync(path.join(root, "big.txt"), "x".repeat(1000));
    const read = await fsx.read("big.txt", 100);
    expect(read.truncated).toBe(true);
    expect(read.content.length).toBe(100);
  });

  it("mkdir/remove/rename work", async () => {
    await fsx.mkdir("nested/deep");
    expect(await fsx.exists("nested/deep")).toBe(true);
    await fsx.write("nested/deep/f.txt", "hi");
    await fsx.rename("nested/deep/f.txt", "nested/f2.txt");
    expect(await fsx.exists("nested/f2.txt")).toBe(true);
    expect(await fsx.exists("nested/deep/f.txt")).toBe(false);
    await fsx.remove("nested", true);
    expect(await fsx.exists("nested")).toBe(false);
  });
});
