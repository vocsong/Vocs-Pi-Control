/**
 * ProcessSupervisor — owns long-running workspace processes.
 *
 * Processes are detached children of the agent, so they survive browser and
 * control-server disconnects. Output is streamed to listeners and a bounded
 * ring buffer is kept per process for late subscribers (reconnect).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { newId, nowIso } from "@pi-control/shared";
import { scrubbedChildEnv } from "./credentials.js";
import type {
  AgentProcessInfo,
  AgentProcessOutputPayload,
  AgentProcessSpawnRequest,
} from "@pi-control/protocol";

export interface ProcessSupervisorEvents {
  onStarted(process: AgentProcessInfo): void;
  onOutput(payload: AgentProcessOutputPayload): void;
  onExited(processId: string, exitCode: number): void;
}

const OUTPUT_RING_BUFFER_LINES = 200;

interface ManagedProcess {
  info: AgentProcessInfo;
  child: ChildProcess;
  listeners: Array<(payload: AgentProcessOutputPayload) => void>;
  buffer: AgentProcessOutputPayload[];
}

export class ProcessSupervisor {
  private readonly processes = new Map<string, ManagedProcess>();

  constructor(private readonly events: ProcessSupervisorEvents) {}

  spawn(request: AgentProcessSpawnRequest): AgentProcessInfo {
    const id = newId("proc");
    const command = request.command.join(" ");
    const cwd = request.cwd ?? "/workspace";
    const now = nowIso();

    const info: AgentProcessInfo = {
      id,
      name: request.name ?? command.slice(0, 60),
      command,
      cwd,
      status: "starting",
      startedAt: now,
    };

    const child = spawn(request.command[0] ?? "", request.command.slice(1), {
      cwd,
      env: scrubbedChildEnv(request.env),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const managed: ManagedProcess = { info, child, listeners: [], buffer: [] };
    this.processes.set(id, managed);

    info.pid = child.pid;
    info.status = "running";
    this.events.onStarted({ ...info });

    child.stdout?.on("data", (chunk: Buffer) => this.dispatch(id, "stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.dispatch(id, "stderr", chunk));

    child.on("error", (error) => {
      managed.info.status = "error";
      this.dispatch(id, "stderr", Buffer.from(`[agent] process error: ${error.message}\n`));
      this.events.onExited(id, -1);
      this.processes.delete(id);
    });

    child.on("exit", (code, signal) => {
      managed.info.status = "exited";
      managed.info.exitedAt = nowIso();
      managed.info.exitCode = code ?? (signal ? -1 : 0);
      if (signal) {
        this.dispatch(id, "stderr", Buffer.from(`[agent] process terminated by signal ${signal}\n`));
      }
      this.events.onExited(id, managed.info.exitCode);
      this.processes.delete(id);
    });

    return { ...info };
  }

  kill(processId: string): void {
    const managed = this.processes.get(processId);
    if (!managed) throw new Error(`Unknown process ${processId}`);
    // Detached children live in their own process group — kill the group.
    try {
      process.kill(-(managed.child.pid ?? 0), "SIGTERM");
    } catch {
      managed.child.kill("SIGTERM");
    }
  }

  list(): AgentProcessInfo[] {
    return [...this.processes.values()].map((m) => ({ ...m.info }));
  }

  /** Snapshot of output for a process (bounded) — used for reconnects. */
  outputSince(processId: string, afterLine?: number): { payloads: AgentProcessOutputPayload[]; lastLine: number } {
    const managed = this.processes.get(processId);
    if (!managed) return { payloads: [], lastLine: 0 };
    const start = afterLine ?? 0;
    return { payloads: managed.buffer.slice(start), lastLine: managed.buffer.length };
  }

  count(): number {
    return this.processes.size;
  }

  shutdown(): void {
    for (const [id, managed] of this.processes) {
      try {
        process.kill(-(managed.child.pid ?? 0), "SIGTERM");
      } catch {
        managed.child.kill("SIGTERM");
      }
      this.processes.delete(id);
    }
  }

  private dispatch(processId: string, stream: "stdout" | "stderr", chunk: Buffer): void {
    const managed = this.processes.get(processId);
    if (!managed) return;
    const text = chunk.toString("utf8");
    if (!text) return;
    const payload: AgentProcessOutputPayload = { processId, stream, text };
    managed.buffer.push(payload);
    if (managed.buffer.length > OUTPUT_RING_BUFFER_LINES) {
      managed.buffer.splice(0, managed.buffer.length - OUTPUT_RING_BUFFER_LINES);
    }
    for (const listener of managed.listeners) listener(payload);
    this.events.onOutput(payload);
  }
}
