import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GitService } from "./gitService.js";

let repo: string;
let git: GitService;

beforeEach(async () => {
  repo = mkdtempSync(path.join(tmpdir(), "pic-git-"));
  await execa("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await execa("git", ["config", "user.email", "test@test"], { cwd: repo });
  await execa("git", ["config", "user.name", "Test"], { cwd: repo });
  git = new GitService(repo);
});

afterEach(() => {
  // Windows may hold a handle briefly after git exits.
  rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe("GitService", () => {
  it("reports clean status on a fresh repo", async () => {
    const status = await git.status();
    expect(status.branch).toBe("main");
    expect(status.changes).toEqual([]);
  });

  it("parses modified, staged and untracked changes", async () => {
    writeFileSync(path.join(repo, "a.txt"), "hello\n");
    await execa("git", ["add", "a.txt"], { cwd: repo });
    writeFileSync(path.join(repo, "b.txt"), "world\n");
    writeFileSync(path.join(repo, "a.txt"), "hello2\n");

    const status = await git.status();
    const byPath = Object.fromEntries(status.changes.map((c) => [c.path, c]));
    expect(byPath["a.txt"]).toMatchObject({ index: "A", worktree: "M", staged: true, untracked: false });
    expect(byPath["b.txt"]).toMatchObject({ untracked: true });
  });

  it("stages, unstages and commits", async () => {
    writeFileSync(path.join(repo, "c.txt"), "content\n");
    await git.stage(["c.txt"]);
    let status = await git.status();
    expect(status.changes[0]?.staged).toBe(true);

    await git.unstage(["c.txt"]);
    status = await git.status();
    expect(status.changes[0]?.staged).toBe(false);

    await git.stage(["c.txt"]);
    const hash = await git.commit("first commit");
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const status2 = await git.status();
    expect(status2.changes).toEqual([]);
  });

  it("creates branches and lists them", async () => {
    writeFileSync(path.join(repo, "f.txt"), "x\n");
    await git.stage(["f.txt"]);
    await git.commit("base");
    await git.branchCreate("feature/x");
    const branches = await git.branches();
    expect(branches.current).toBe("feature/x");
    expect(branches.branches.map((b) => b.name)).toEqual(["feature/x", "main"]);
    expect(branches.branches.find((b) => b.name === "feature/x")?.current).toBe(true);
  });

  it("rejects invalid branch names before running git", async () => {
    await expect(git.branchCreate("bad..name")).rejects.toThrow(/invalid branch name/);
    await expect(git.branchCreate("has space")).rejects.toThrow(/invalid branch name/);
  });

  it("produces a diff and a log", async () => {
    writeFileSync(path.join(repo, "d.txt"), "one\n");
    await git.stage(["d.txt"]);
    await git.commit("one");
    writeFileSync(path.join(repo, "d.txt"), "two\n");
    const diff = await git.diff();
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
    const log = await git.log(5);
    expect(log[0]?.subject).toBe("one");
    expect(log[0]?.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("rejects cwd escapes", async () => {
    await expect(git.status("../outside")).rejects.toThrow(/escapes/);
  });
});
