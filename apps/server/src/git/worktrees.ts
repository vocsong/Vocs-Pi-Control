/**
 * GitWorktreeService — controlled server-side worktree creation (plan §14).
 *
 * The server owns host paths, so worktree creation runs here: the sibling
 * directory `<repo-parent>/.pi-control-worktrees/<projectId>/<name>` is
 * created via `git worktree add`, then a NEW workspace (and therefore a new
 * sandbox container) is created pointing at it (Invariant D).
 *
 * Every input is validated: the repo root must exist, the branch name must
 * pass `git check-ref-format`, and the target path must stay under the
 * configured worktree root.
 */

import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { SandboxManager } from "../sandbox/manager.js";
import type { Logger } from "../logger.js";

export interface CreateWorktreeInput {
  workspaceId: string;
  /** Sandbox/workspace name (also used as the worktree directory name). */
  name: string;
  /** New branch name (defaults to the workspace name). */
  branch?: string;
}

export interface CreatedWorktree {
  workspaceId: string;
  worktreePath: string;
  branch: string;
}

const WORKTREE_ROOT_DIR = ".pi-control-worktrees";

export class GitWorktreeService {
  constructor(
    private readonly sandbox: SandboxManager,
    private readonly logger: Logger,
  ) {}

  async create(input: CreateWorktreeInput): Promise<CreatedWorktree> {
    const workspace = this.sandbox.workspaceById(input.workspaceId);
    if (!workspace) throw new Error(`Unknown workspace ${input.workspaceId}`);

    const repoRoot = await this.repoRootOf(workspace.hostRootPath);
    const branch = input.branch ?? sanitizeName(input.name);
    await this.validateRef(branch);

    const worktreeRoot = path.join(path.dirname(repoRoot), WORKTREE_ROOT_DIR, workspace.id);
    const target = path.join(worktreeRoot, sanitizeName(input.name));
    fs.mkdirSync(worktreeRoot, { recursive: true });
    if (fs.existsSync(target)) {
      throw new Error(`Worktree already exists: ${target}`);
    }

    // git worktree add -b <branch> <target> [<from>] — controlled args only.
    const args = ["worktree", "add", "-b", branch, target];
    const result = await execa("git", args, { cwd: repoRoot, reject: false });
    if (result.exitCode !== 0) {
      throw new Error(`git worktree add failed: ${result.stderr.trim()}`);
    }

    // Create the workspace folder + its primary sandbox (mounts the worktree).
    let sandbox: { id: string };
    try {
      ({ sandbox } = await this.sandbox.createWorkspace({
        name: input.name,
        hostRootPath: target,
        kind: "worktree",
        gitBranch: branch,
        sandboxHostPath: target,
      }));
    } catch (error) {
      // Compensation (#14): the git worktree + branch were created before
      // the workspace; remove them so a retry starts clean.
      try {
        await execa("git", ["worktree", "remove", "--force", target], { cwd: repoRoot, reject: false });
      } catch {
        // best-effort
      }
      try {
        await execa("git", ["branch", "-D", branch], { cwd: repoRoot, reject: false });
      } catch {
        // best-effort
      }
      this.logger.warn({ worktreePath: target, error: String(error) }, "worktree creation rolled back");
      throw error;
    }
    this.logger.info(
      { sandboxId: sandbox.id, worktreePath: target, branch },
      "worktree sandbox created",
    );
    return { workspaceId: sandbox.id, worktreePath: target, branch };
  }

  /** List worktree workspaces for a project (from the control plane). */
  list(workspaceId: string): Array<{ sandboxId: string; name: string; path: string; branch: string | undefined }> {
    return this.sandbox
      .listSandboxes(workspaceId)
      .filter((s) => s.kind === "worktree")
      .map((s) => ({ sandboxId: s.id, name: s.name, path: s.hostPath, branch: s.gitBranch }));
  }

  private async repoRootOf(hostPath: string): Promise<string> {
    const result = await execa("git", ["rev-parse", "--show-toplevel"], {
      cwd: hostPath,
      reject: false,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Not a git repository: ${hostPath}`);
    }
    return result.stdout.trim();
  }

  private async validateRef(branch: string): Promise<void> {
    const check = await execa("git", ["check-ref-format", `refs/heads/${branch}`], { reject: false });
    if (check.exitCode !== 0) throw new Error(`Invalid branch name: ${branch}`);
  }
}

function sanitizeName(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  if (!cleaned) throw new Error("Invalid name");
  return cleaned;
}
