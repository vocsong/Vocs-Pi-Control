/**
 * Host path translation for Podman Machine hosts.
 *
 * On macOS/Windows, Podman runs containers inside a VM. Host paths must be
 * translated to the machine's filesystem before they can be bind-mounted
 * (plan §7.3: "Do not assume Windows paths can be inserted into Linux
 * commands verbatim. Centralize path translation and mounting behavior
 * inside the Podman adapter.").
 */

import os from "node:os";
import path from "node:path";

export type MachineProvider = "wsl" | "hyperv" | "applevirt" | "qemu" | "libkrun" | "unknown";

export interface PathTranslationResult {
  /** Path as seen inside the Podman machine (usable in --volume). */
  machinePath: string;
  /** Extra `podman machine` share volume needed (macOS, path outside default shares). */
  share?: { hostPath: string; guestPath: string };
}

/**
 * Translate a host path into the Podman machine filesystem.
 *
 * - linux: passthrough (rootless Podman runs on the host directly).
 * - win32: drive letters become /mnt/<letter> (WSL provider mounts Windows
 *   drives into the machine distro).
 * - darwin: default shares mirror the user home directory at the same path;
 *   paths outside $HOME are rejected unless a machine share is configured
 *   (Phase 11+).
 */
export function translateHostPath(
  hostPath: string,
  options: { platform?: NodeJS.Platform; homeDir?: string } = {},
): PathTranslationResult {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();

  switch (platform) {
    case "linux":
      return { machinePath: hostPath };

    case "win32": {
      const resolved = path.resolve(hostPath);
      const drive = resolved.slice(0, 2).toLowerCase();
      if (!/^[a-z]:$/.test(drive)) {
        throw new Error(`Cannot translate Windows path to machine path: ${hostPath}`);
      }
      const rest = resolved.slice(2).replaceAll("\\", "/");
      return { machinePath: `/mnt/${drive[0]}${rest}` };
    }

    case "darwin": {
      // macOS paths are absolute POSIX paths; resolve() on other platforms
      // would mangle them, so normalize manually.
      const resolved = hostPath.replace(/\/+$/, "");
      const homePrefix = homeDir.endsWith("/") ? homeDir : `${homeDir}/`;
      if (resolved === homeDir || resolved.startsWith(homePrefix)) {
        return { machinePath: resolved };
      }
      throw new Error(
        `Path outside the Podman Machine default share (${homeDir}) cannot be mounted: ${hostPath}. ` +
          "Add a machine share or choose a folder inside your home directory.",
      );
    }

    default:
      throw new Error(`Unsupported platform for Podman path translation: ${platform}`);
  }
}

/** Best-effort provider detection from a `podman machine list` row. */
export function detectProvider(
  row: { VMType?: string; Provider?: string } | undefined,
  platform: NodeJS.Platform = process.platform,
): MachineProvider {
  if (platform !== "win32" && platform !== "darwin") return "unknown";
  const raw = (row?.VMType ?? row?.Provider ?? "").toLowerCase();
  if (raw.includes("wsl")) return "wsl";
  if (raw.includes("hyperv")) return "hyperv";
  if (raw.includes("apple")) return "applevirt";
  if (raw.includes("qemu")) return "qemu";
  if (raw.includes("libkrun")) return "libkrun";
  // Windows default provider when WSL is available.
  if (platform === "win32") return "wsl";
  return "unknown";
}
