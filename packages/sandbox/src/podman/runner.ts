/**
 * Thin runner around the `podman` CLI.
 *
 * Centralizes process execution, timeouts, output truncation and error
 * normalization. The rest of the sandbox package (and the control server)
 * never shells out to podman directly.
 */

import { execa } from "execa";

export interface PodmanRunOptions {
  timeoutMs?: number;
  input?: string;
  maxOutputBytes?: number;
  /** Reject on non-zero exit (default true). */
  reject?: boolean;
}

export interface PodmanResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

export class PodmanError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "PodmanError";
  }
}

export interface PodmanRunner {
  podman(args: string[], options?: PodmanRunOptions): Promise<PodmanResult>;
  /** Raw execa child for streaming commands (logs -f). */
  podmanStream(args: string[]): Promise<{ stdout: AsyncIterable<string>; stderr: AsyncIterable<string>; cancel(): void }>;
}

export const MAX_OUTPUT_BYTES_DEFAULT = 256 * 1024;

export function createPodmanRunner(): PodmanRunner {
  return {
    async podman(args, options = {}) {
      const maxOutput = options.maxOutputBytes ?? MAX_OUTPUT_BYTES_DEFAULT;
      try {
        const result = await execa("podman", args, {
          timeout: options.timeoutMs ?? 120_000,
          input: options.input,
          reject: options.reject ?? true,
        });
        return {
          stdout: truncate(result.stdout, maxOutput),
          stderr: truncate(result.stderr, 64 * 1024),
          exitCode: result.exitCode ?? -1,
          truncated: result.stdout.length > maxOutput,
        };
      } catch (error) {
        const err = error as {
          code?: string | number;
          stdout?: string;
          stderr?: string;
          shortMessage?: string;
        };
        if (err.code === "ENOENT") {
          throw new PodmanError(podmanNotInstalledMessage(), args);
        }
        if (err.code === "ETIMEDOUT" || typeof err.code === "string" && err.code.startsWith("ETIMEDOUT")) {
          throw new PodmanError(`podman timed out: ${args.join(" ")}`, args);
        }
        const stderr = truncate(err.stderr ?? "", 64 * 1024);
        const stdout = truncate(err.stdout ?? "", 64 * 1024);
        throw new PodmanError(
          stderr.trim() || stdout.trim() || `podman failed: ${args.join(" ")}`,
          args,
          typeof err.code === "number" ? err.code : undefined,
          stderr,
        );
      }
    },

    async podmanStream(args) {
      const child = execa("podman", args, { reject: false });
      return {
        stdout: child.stdout as unknown as AsyncIterable<string>,
        stderr: child.stderr as unknown as AsyncIterable<string>,
        cancel: () => {
          void child.kill("SIGTERM");
        },
      };
    },
  };
}

export function podmanNotInstalledMessage(): string {
  const lines = [
    "Podman is not installed or not on PATH.",
    "Install it, then run sandbox preparation again:",
    "  - Windows: winget install Redhat.Podman",
    "  - macOS:   brew install podman",
    "  - Ubuntu:  sudo apt install podman",
  ];
  return lines.join("\n");
}

function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8") + "\n…[truncated]";
}
