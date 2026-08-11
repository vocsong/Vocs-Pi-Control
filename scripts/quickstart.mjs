#!/usr/bin/env node
/**
 * Vocs Pi Control — one-command quickstart.
 *
 *   git clone https://github.com/vocsong/Vocs-Pi-Control.git
 *   cd Vocs-Pi-Control
 *   npm run quickstart          # (or: pnpm quickstart / node scripts/quickstart.mjs)
 *
 * What it does:
 *   1. checks Node >= 22.19 and installs/activates pnpm when missing
 *   2. installs dependencies (pnpm install)
 *   3. detects Podman; installs it on Windows/macOS/Ubuntu when missing
 *      (asks first; without it the app runs in mock mode with a warning)
 *   4. builds the sandbox base image (podman only)
 *   5. starts the control server + web UI, waits for health
 *   6. opens http://127.0.0.1:5173 in your browser
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import os from "node:os";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB_URL = "http://127.0.0.1:5173";
const HEALTH_URL = "http://127.0.0.1:5174/api/health";

const log = (msg) => console.log(`\x1b[36m[quickstart]\x1b[0m ${msg}`);
const ok = (msg) => console.log(`\x1b[32m  ✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`\x1b[33m  !\x1b[0m ${msg}`);

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: options.silent ? "ignore" : "inherit",
      env: { ...process.env, ...(options.env ?? {}) },
    });
    child.on("exit", (code) => resolve(code ?? -1));
  });
}

function podmanPath() {
  // Windows installer lives off PATH for fresh shells.
  const candidates = [
    "podman",
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "RedHat", "Podman", "podman.exe"),
  ];
  for (const candidate of candidates) {
    const found = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (found.status === 0) return candidate;
  }
  return null;
}

async function ensurePnpm() {
  const found = spawnSync("pnpm", ["--version"], { stdio: "ignore" });
  if (found.status === 0) {
    ok("pnpm found");
    return "pnpm";
  }
  log("pnpm missing — activating via corepack…");
  const corepack = spawnSync("corepack", ["enable", "--install-directory", os.homedir()], { stdio: "ignore" });
  if (corepack.status === 0) {
    ok("corepack enabled pnpm");
    return "pnpm";
  }
  warn("corepack unavailable; falling back to npx pnpm (slower)");
  return "npx --yes pnpm@11";
}

async function ensurePodman() {
  const existing = podmanPath();
  if (existing) {
    ok(`podman found: ${existing}`);
    return existing;
  }
  log("Podman not detected — the sandbox needs it for real isolation.");
  if (!process.env.CI) {
    const answer = await ask("Attempt to install Podman now? [Y/n]");
    if (answer === "n" || answer === "no") {
      warn("continuing WITHOUT Podman — the app runs in mock mode (no isolation).");
      return null;
    }
  } else {
    warn("CI detected — skipping installation; mock mode.");
    return null;
  }

  const platform = process.platform;
  let cmd, args;
  if (platform === "win32") {
    cmd = "winget";
    args = ["install", "--id", "Redhat.Podman", "--silent", "--accept-package-agreements", "--accept-source-agreements"];
  } else if (platform === "darwin") {
    cmd = "brew";
    args = ["install", "podman"];
  } else {
    cmd = "sudo";
    args = ["apt-get", "install", "-y", "podman"];
  }
  const code = await run(cmd, args);
  if (code === 0) {
    const again = podmanPath();
    if (again) {
      ok("podman installed");
      return again;
    }
  }
  warn("podman installation failed — continuing in mock mode (no isolation).");
  warn("See https://podman.io/docs/installation for manual install steps.");
  return null;
}

async function waitForHealth(timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  console.log("\n\x1b[1m◆ Vocs Pi Control — quickstart\x1b[0m\n");

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22) {
    console.error(`\x1b[31mNode >= 22.19 required (have ${process.versions.node}). Install it first:\x1b[0m`);
    console.error("  https://nodejs.org/");
    process.exit(1);
  }
  ok(`node ${process.versions.node}`);

  const pkg = await ensurePnpm();

  log("installing dependencies…");
  const installCode = await run(pkg, ["install"]);
  if (installCode !== 0) {
    console.error("\x1b[31mDependency install failed.\x1b[0m");
    process.exit(1);
  }
  ok("dependencies installed");

  const podman = await ensurePodman();
  const env = podman ? { PATH: `${path.dirname(podman)}${path.delimiter}${process.env.PATH ?? ""}` } : {};

  if (podman) {
    log("building the sandbox base image (first run downloads the base layers)…");
    const buildCode = await run(pkg, ["image:base"], { env, silent: false });
    if (buildCode === 0) ok("base image ready");
    else warn("base image build failed — workspaces will fall back to available images");
  }

  log("starting the control server…");
  const server = spawn(process.execPath, [path.join(ROOT, "apps", "server", "node_modules", "tsx", "dist", "cli.mjs"), "watch", "src/index.ts"], {
    cwd: path.join(ROOT, "apps", "server"),
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
  server.unref();

  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("\x1b[31mControl server did not become healthy.\x1b[0m");
    console.error("Check the server log: run `pnpm --filter @pi-control/server dev` in a terminal.");
    process.exit(1);
  }
  ok("control server healthy on http://127.0.0.1:5174");

  log("starting the web UI…");
  const web = spawn(process.execPath, [path.join(ROOT, "apps", "web", "node_modules", "vite", "bin", "vite.js")], {
    cwd: path.join(ROOT, "apps", "web"),
    detached: true,
    stdio: "ignore",
  });
  web.unref();

  await new Promise((r) => setTimeout(r, 3000));
  ok(`web UI ready at ${WEB_URL}`);

  try {
    const openCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    spawnSync(openCmd, [WEB_URL], { stdio: "ignore", shell: process.platform === "win32" });
  } catch {
    // opening the browser is best-effort
  }

  console.log("\n\x1b[1m◆ Vocs Pi Control is running\x1b[0m");
  console.log(`  UI:      ${WEB_URL}`);
  console.log(`  API:     http://127.0.0.1:5174`);
  if (podman) {
    console.log("\n  Next steps:");
    console.log("   1. In the UI: Prepare sandbox (sidebar → Sandbox), then Add a project folder.");
    console.log("   2. Start the workspace, then create a session — a real Pi agent runs inside");
    console.log("      a rootless container with your folder mounted at /workspace.");
    console.log("   3. Set a provider key (ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, …) and restart the");
    console.log("      server to unlock models: `pnpm --filter @pi-control/server dev`.");
  } else {
    console.log("\n  ⚠ Running in MOCK mode — no container isolation. Install Podman and re-run");
    console.log("    `npm run quickstart` for the real sandboxed experience.");
  }
  console.log("\n  Stop everything: close the browser and run `taskkill //F //IM node.exe` (win)");
  console.log("  or `pkill -f 'pi-control|vite'` (mac/linux), or just close your terminal session.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
