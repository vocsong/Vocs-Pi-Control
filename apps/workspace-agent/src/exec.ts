/**
 * One-shot exec inside the sandbox (request/response, no long-lived output
 * streams). Used by the control server's exec endpoints and later by the
 * controlled file/Git services.
 */

import { spawn } from "node:child_process";
import type { AgentExecExitPayload, AgentExecRequest } from "@pi-control/protocol";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export function runExec(request: AgentExecRequest, emitOutput?: (stream: "stdout" | "stderr", text: string) => void): Promise<ExecResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const command = request.command;
    const maxOutput = request.maxOutputBytes ?? 256 * 1024;
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;

    const child = spawn(command[0] ?? "", command.slice(1), {
      cwd: request.cwd ?? "/workspace",
      env: { ...process.env, ...request.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result: ExecResult = {
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        truncated,
      };
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      emitOutput?.("stdout", text);
      if (Buffer.byteLength(stdout) >= maxOutput) {
        truncated = true;
      } else {
        stdout += text;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      emitOutput?.("stderr", text);
      if (Buffer.byteLength(stderr) >= maxOutput) {
        truncated = true;
      } else {
        stderr += text;
      }
    });
    child.on("error", (error) => {
      stderr += `[agent] exec error: ${error.message}\n`;
      finish(-1);
    });
    child.on("exit", (code) => finish(code ?? -1));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, request.timeoutMs ?? 120_000);
  });
}

export function toExitPayload(commandId: string, result: ExecResult): AgentExecExitPayload {
  return {
    commandId,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
