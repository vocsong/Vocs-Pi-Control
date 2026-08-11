/**
 * FileService — controlled filesystem operations inside the sandbox
 * (plan §29). The workspace root is the ONLY accessible tree: every path is
 * resolved against it and verified to remain inside it (defense in depth on
 * top of the container mount boundary).
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentFileEntry } from "@pi-control/protocol";

export class FileService {
  private readonly root: string;
  private readonly rootReal: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.rootReal = fs.realpathSync(this.root);
  }

  /** Resolve a user-supplied path against the workspace root. */
  resolve(relPath: string): string {
    if (!relPath) return this.root;
    if (path.isAbsolute(relPath)) {
      throw new Error(`absolute paths are not allowed: ${relPath}`);
    }
    const resolved = path.resolve(this.root, relPath);
    this.assertContained(resolved);
    return resolved;
  }

  /**
   * Containment check: lexical first (works for paths that do not exist
   * yet), then real-path (symlink-aware) for existing paths.
   */
  private assertContained(resolved: string): void {
    const outside = (p: string): boolean => p !== this.rootReal && !p.startsWith(this.rootReal + path.sep);
    if (outside(resolved)) {
      throw new Error(`path escapes the workspace: ${resolved}`);
    }
    try {
      const real = fs.realpathSync(resolved);
      if (outside(real)) {
        throw new Error(`path escapes the workspace: ${resolved}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Non-existent target: lexical containment already verified.
    }
  }

  async list(relDir = ""): Promise<AgentFileEntry[]> {
    const dir = this.resolve(relDir);
    const stat = await fs.promises.stat(dir);
    if (!stat.isDirectory()) throw new Error(`not a directory: ${relDir || "/"}`);
    const names = await fs.promises.readdir(dir);
    const entries: AgentFileEntry[] = [];
    for (const name of names) {
      const abs = path.join(dir, name);
      try {
        const st = await fs.promises.lstat(abs);
        const rel = path.relative(this.root, abs).split(path.sep).join("/");
        entries.push({
          name,
          path: rel,
          type: st.isDirectory() ? "dir" : st.isSymbolicLink() ? "symlink" : st.isFile() ? "file" : "other",
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      } catch {
        // race: file disappeared between readdir and lstat
      }
    }
    entries.sort((a, b) => (a.type === "dir" ? -1 : 1) - (b.type === "dir" ? -1 : 1) || a.name.localeCompare(b.name));
    return entries;
  }

  async read(relPath: string, maxBytes = 512 * 1024): Promise<{ content: string; encoding: "utf8" | "base64"; truncated: boolean; size: number }> {
    const abs = this.resolve(relPath);
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile()) throw new Error(`not a file: ${relPath}`);
    const buffer = await fs.promises.readFile(abs);
    const truncated = buffer.length > maxBytes;
    const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
    // Binary detection: NUL bytes or invalid UTF-8 → base64.
    let encoding: "utf8" | "base64" = "utf8";
    let content = slice.toString("utf8");
    if (slice.includes(0) || content.includes("\uFFFD")) {
      encoding = "base64";
      content = slice.toString("base64");
    }
    return { content, encoding, truncated, size: buffer.length };
  }

  async write(relPath: string, content: string, encoding: "utf8" | "base64" = "utf8"): Promise<number> {
    const abs = this.resolve(relPath);
    const buffer = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, buffer);
    return buffer.length;
  }

  async mkdir(relPath: string, recursive = true): Promise<void> {
    await fs.promises.mkdir(this.resolve(relPath), { recursive });
  }

  async remove(relPath: string, recursive = false): Promise<void> {
    await fs.promises.rm(this.resolve(relPath), { recursive });
  }

  async rename(from: string, to: string): Promise<void> {
    const src = this.resolve(from);
    const dst = this.resolve(to);
    await fs.promises.rename(src, dst);
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.promises.stat(this.resolve(relPath));
      return true;
    } catch {
      return false;
    }
  }
}
