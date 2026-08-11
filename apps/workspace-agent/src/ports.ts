/**
 * Port discovery inside the sandbox (plan §16.2).
 *
 * Reads listening TCP ports: /proc/net/tcp on Linux (container), netstat
 * on Windows (host dev). The control server maps container ports to
 * loopback URLs using the published dev-port range.
 */

import { execa } from "execa";
import type { AgentListeningPort } from "@pi-control/protocol";

export async function listListeningPorts(): Promise<AgentListeningPort[]> {
  if (process.platform === "win32") {
    return windowsPorts();
  }
  return linuxPorts();
}

/** Parse /proc/net/tcp (Linux). */
async function linuxPorts(): Promise<AgentListeningPort[]> {
  try {
    const result = await execa("sh", ["-c", "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null"], { reject: false });
    const ports = new Map<number, string>();
    const lines = result.stdout.split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const state = parts[3] ?? "";
      if (state !== "0A") continue; // LISTEN
      const local = parts[1] ?? "";
      const [addrHex, portHex] = local.split(":");
      if (!portHex) continue;
      const port = Number.parseInt(portHex, 16);
      if (Number.isNaN(port) || port === 0) continue;
      const address = (addrHex ?? "").includes(":") && addrHex !== "00000000000000000000000000000000" ? "[::]" : "0.0.0.0";
      ports.set(port, address);
    }
    return [...ports.entries()].map(([port, address]) => ({ port, address }));
  } catch {
    return [];
  }
}

/** Parse `netstat -ano` (Windows host dev). */
async function windowsPorts(): Promise<AgentListeningPort[]> {
  try {
    const result = await execa("netstat", ["-ano", "-p", "tcp"], { reject: false });
    const ports = new Map<number, string>();
    for (const line of result.stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      if ((parts[3] ?? "") !== "LISTENING") continue;
      const local = parts[1] ?? "";
      const lastColon = local.lastIndexOf(":");
      const port = Number(local.slice(lastColon + 1));
      if (Number.isNaN(port) || port === 0) continue;
      const address = local.startsWith("0.0.0.0") ? "0.0.0.0" : local.slice(0, lastColon);
      ports.set(port, address);
    }
    return [...ports.entries()].map(([port, address]) => ({ port, address }));
  } catch {
    return [];
  }
}
