/**
 * TerminalManager — PTY ownership inside the sandbox (plan §31).
 *
 * Uses node-pty when available (installed in the container image); falls
 * back to a piped child_process on hosts without it (e.g. Windows dev,
 * where node-pty needs a C toolchain). Output is streamed to listeners and
 * a bounded ring buffer keeps reconnect replay possible. Terminals survive
 * browser and control-server disconnects.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { scrubbedChildEnv } from "./credentials.js";
import { newId, nowIso } from "@pi-control/shared";
import type { AgentTerminalInfo, AgentTerminalOpenRequest } from "@pi-control/protocol";

declare const __dirname: string | undefined;

interface PtyLike {
  on(event: "data", cb: (data: string) => void): void;
  on(event: "exit", cb: (exitCode: number) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  process: string;
}

interface ManagedTerminal {
  info: AgentTerminalInfo;
  pty: PtyLike | null;
  child: ChildProcess | null;
  buffer: string;
  listeners: Array<(data: string) => void>;
}

const MAX_BUFFER_CHARS = 64 * 1024;

function loadPty(): typeof import("node-pty") | null {
  try {
    const requireFn =
      typeof __dirname === "string"
        ? createRequire(path.join(__dirname, "pi-control-agent.cjs"))
        : createRequire(import.meta.url);
    return requireFn("node-pty") as typeof import("node-pty");
  } catch {
    return null;
  }
}

export interface TerminalManagerEvents {
  onOutput(terminalId: string, data: string): void;
  onClosed(terminalId: string): void;
}

export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();
  private readonly ptyModule = loadPty();

  constructor(
    private readonly cwd: string,
    private readonly events: TerminalManagerEvents,
  ) {}

  get ptyAvailable(): boolean {
    return this.ptyModule !== null;
  }

  open(request: AgentTerminalOpenRequest): AgentTerminalInfo {
    const id = request.id ?? newId("term");
    const shell = request.shell ?? defaultShell();
    const cols = request.cols ?? 80;
    const rows = request.rows ?? 24;
    const info: AgentTerminalInfo = {
      id,
      shell,
      cols,
      rows,
      openedAt: nowIso(),
      buffer: "",
    };

    let pty: PtyLike | null = null;
    let child: ChildProcess | null = null;

    if (this.ptyModule) {
      pty = this.ptyModule.spawn(shell, [], {
        cols,
        rows,
        cwd: this.cwd,
        env: scrubbedChildEnv() as Record<string, string>,
        name: "xterm-256color",
      }) as unknown as PtyLike;
      pty.on("data", (data: string) => this.dispatch(id, data));
      pty.on("exit", () => this.close(id));
    } else {
      child = spawn(shell, [], {
        cwd: this.cwd,
        env: scrubbedChildEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk: Buffer) => this.dispatch(id, chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => this.dispatch(id, chunk.toString("utf8")));
      child.on("exit", () => this.close(id));
      child.on("error", () => this.close(id));
      // Announce the shell is ready (piped mode has no banner otherwise).
      this.dispatch(id, `\r\n[pi-control] ${shell} (pipe fallback — node-pty not available)\r\n`);
    }

    this.terminals.set(id, { info, pty, child, buffer: "", listeners: [] });
    return { ...info };
  }

  write(id: string, data: string): void {
    const terminal = this.require(id);
    if (terminal.pty) {
      terminal.pty.write(data);
    } else {
      terminal.child?.stdin?.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.require(id);
    terminal.info.cols = cols;
    terminal.info.rows = rows;
    terminal.pty?.resize(cols, rows);
  }

  close(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    try {
      terminal.pty?.kill();
    } catch {
      // already gone
    }
    terminal.child?.kill();
    this.terminals.delete(id);
    this.events.onClosed(id);
  }

  list(): AgentTerminalInfo[] {
    return [...this.terminals.values()].map((t) => ({ ...t.info }));
  }

  count(): number {
    return this.terminals.size;
  }

  shutdown(): void {
    for (const id of [...this.terminals.keys()]) {
      this.close(id);
    }
  }

  /* ------------------------------------------------------------------ */

  private require(id: string): ManagedTerminal {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error(`Unknown terminal ${id}`);
    return terminal;
  }

  private dispatch(id: string, data: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal || !data) return;
    terminal.buffer += data;
    if (terminal.buffer.length > MAX_BUFFER_CHARS) {
      terminal.buffer = terminal.buffer.slice(-MAX_BUFFER_CHARS);
    }
    terminal.info.buffer = terminal.buffer;
    for (const listener of [...terminal.listeners]) listener(data);
    this.events.onOutput(id, data);
  }
}

function defaultShell(): string {
  if (process.platform === "win32") return process.env.COMSPEC ?? "cmd.exe";
  return process.env.SHELL ?? "/bin/sh";
}
