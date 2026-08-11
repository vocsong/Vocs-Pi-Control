/**
 * Bundle the workspace agent into a single CJS file for the base image.
 * Output: images/base/agent/agent.cjs (bundled with ws + protocol).
 *
 * CJS is required: `ws` uses dynamic require() for node builtins, which
 * esbuild's ESM output cannot support.
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const outfile = path.join(root, "images", "base", "agent", "agent.cjs");

await build({
  entryPoints: [path.join(root, "apps", "workspace-agent", "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile,
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});

console.log(`agent bundle written to ${outfile}`);
