/**
 * GitService — controlled Git operations inside the sandbox (plan §30).
 * Real Git through execa argument arrays (no shell interpolation); every
 * repo path stays under the workspace root. Worktree creation happens
 * server-side (it needs host filesystem access for the sibling directory).
 */

import { execa } from "execa";
import path from "node:path";
import type {
  AgentGitBranch,
  AgentGitChange,
  AgentGitLogEntry,
} from "@pi-control/protocol";

export class GitService {
  constructor(private readonly root: string) {}

  private cwd(relCwd?: string): string {
    if (!relCwd) return this.root;
    const resolved = path.resolve(this.root, relCwd);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`git cwd escapes the workspace: ${relCwd}`);
    }
    return resolved;
  }

  private async run(args: string[], cwd?: string, maxBytes = 4 * 1024 * 1024): Promise<string> {
    const result = await execa("git", args, { cwd: this.cwd(cwd), reject: false, maxBuffer: maxBytes });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args[0] ?? ""} failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return result.stdout;
  }

  async status(relCwd?: string): Promise<{ branch: string; ahead: number; behind: number; changes: AgentGitChange[] }> {
    const [branchLine, porcelain, aheadBehind] = await Promise.all([
      this.run(["branch", "--show-current"], relCwd),
      this.run(["status", "--porcelain=v1", "-z", "--branch"], relCwd),
      this.run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], relCwd).catch(() => ""),
    ]);
    const branch = branchLine.trim() || "(no commits)";
    const [ahead = "0", behind = "0"] = aheadBehind.trim().split(/\s+/);
    const changes: AgentGitChange[] = [];
    const fields = porcelain.split("\0");
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] ?? "";
      if (!field) continue;
      // Skip the --branch header line (## main...origin/main).
      if (field.startsWith("## ")) continue;
      // With -z, each entry is "XY path" in ONE field (renames add a
      // second field for the target path).
      const meta = field.slice(0, 2);
      const filePath = field.length > 3 ? field.slice(3) : "";
      if (meta === "??") {
        changes.push({ path: filePath, index: "?", worktree: "?", staged: false, untracked: true });
        continue;
      }
      if (meta[0] === "R" || meta[0] === "C") {
        const target = fields[i + 1] ?? "";
        i++;
        changes.push({ path: target, index: meta[0] ?? "", worktree: meta[1] ?? "", staged: true, untracked: false });
        continue;
      }
      changes.push({
        path: filePath,
        index: meta[0] ?? "",
        worktree: meta[1] ?? "",
        staged: meta[0] !== " " && meta[0] !== "?",
        untracked: false,
      });
    }
    return { branch, ahead: Number(ahead) || 0, behind: Number(behind) || 0, changes };
  }

  async diff(staged = false): Promise<string> {
    const args = ["diff", "--no-ext-diff"];
    if (staged) args.push("--cached");
    return this.run(args);
  }

  async stage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.run(["add", "--", ...paths]);
  }

  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    try {
      await this.run(["restore", "--staged", "--", ...paths]);
    } catch (error) {
      // restore --staged needs a HEAD; on a fresh repo fall back to rm --cached.
      if (String(error).includes("could not resolve HEAD")) {
        await this.run(["rm", "--cached", "--", ...paths]);
        return;
      }
      throw error;
    }
  }

  async commit(message: string): Promise<string> {
    await this.run(["commit", "-m", message]);
    const hash = await this.run(["rev-parse", "HEAD"]);
    return hash.trim();
  }

  async branches(): Promise<{ current: string; branches: AgentGitBranch[] }> {
    const [current, list] = await Promise.all([
      this.run(["branch", "--show-current"]),
      this.run(["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
    ]);
    const currentBranch = current.trim();
    const branches = list
      .split("\n")
      .filter(Boolean)
      .map((name) => ({ name: name.trim(), current: name.trim() === currentBranch }));
    return { current: currentBranch || "(detached)", branches };
  }

  async branchCreate(name: string, from?: string): Promise<void> {
    // Validate the ref name BEFORE running git (defense in depth).
    const check = await execa("git", ["check-ref-format", `refs/heads/${name}`], { reject: false });
    if (check.exitCode !== 0) throw new Error(`invalid branch name: ${name}`);
    const args = ["checkout", "-b", name];
    if (from) args.push(from);
    await this.run(args);
  }

  async log(max = 20): Promise<AgentGitLogEntry[]> {
    const out = await this.run([
      "log",
      `-n ${max}`,
      "--format=%H%x09%an%x09%ad%x09%s",
      "--date=iso-strict",
    ]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, author, date, ...subjectParts] = line.split("\t");
        return { hash: hash ?? "", author: author ?? "", date: date ?? "", subject: subjectParts.join("\t") };
      });
  }
}
