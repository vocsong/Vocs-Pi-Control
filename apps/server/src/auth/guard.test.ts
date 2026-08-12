import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, schema, type Db } from "@pi-control/database";
import { MockSandboxRuntime } from "@pi-control/sandbox/mock";
import { MockPiDriver } from "@pi-control/pi-driver/mock";
import { RealtimeHub } from "../realtime/hub.js";
import { createLogger } from "../logger.js";
import { AgentManager } from "../agents/agentManager.js";
import { SandboxManager } from "../sandbox/manager.js";
import { SessionManager } from "../sessions/manager.js";
import { WorkspaceSessionManager } from "../sessions/workspaceSessions.js";
import { LeaseManager } from "../realtime/leases.js";
import { GitWorktreeService } from "../git/worktrees.js";
import { buildApp, type AppDeps } from "../app.js";
import { SessionStore } from "./store.js";
import type { AppFastify } from "../types.js";

const TOKEN = "test-bootstrap-token";
let db: Db;
let app: AppFastify;
let scratch: string;
let store: SessionStore;

beforeAll(async () => {
  scratch = mkdtempSync(path.join(tmpdir(), "pic-auth-test-"));
  db = openDb(":memory:");
  db.insert(schema.machines)
    .values({
      id: "machine_local",
      name: "test machine",
      kind: "local",
      hostname: "test",
      platform: "linux",
      status: "online",
      capabilitiesJson: "{}",
      createdAt: new Date().toISOString(),
    })
    .run();
  const logger = createLogger("silent");
  const hub = new RealtimeHub(logger);
  const agents = new AgentManager(hub, logger);
  const sandbox = new SandboxManager({
    db,
    runtime: new MockSandboxRuntime({ speedMs: 0 }),
    hub,
    logger,
    agents,
    baseImage: "pi-control/base:local",
    imagesDir: process.cwd(),
    rootFolder: () => scratch,
  });
  const sessions = new SessionManager(db, hub, () => new MockPiDriver({ speedMs: 1 }), logger);
  const workspaceSessions = new WorkspaceSessionManager(
    db,
    agents,
    hub,
    logger,
    () => ({ defaultModel: null, defaultThinkingLevel: null, showThinkingByDefault: false }),
    (sandboxId) => sandbox.ensureSandboxRunning(sandboxId),
  );
  const leases = new LeaseManager({ enforcePrompts: false });
  const worktrees = new GitWorktreeService(sandbox, logger);
  store = new SessionStore();
  const deps: AppDeps = {
    logger,
    db,
    hub,
    sessions,
    workspaceSessions,
    sandbox,
    agents,
    worktrees,
    leases,
    runtimeName: "mock",
    auth: {
      sessions: store,
      token: TOKEN,
      allowedHosts: ["127.0.0.1", "localhost"],
      allowedOrigins: ["127.0.0.1", "localhost"],
      publicPaths: ["/api/health", "/api/auth/status", "/api/auth/login"],
    },
  };
  app = await buildApp(deps);
});

afterAll(async () => {
  await app.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function login(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { token: TOKEN },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) as string;
  return cookie.split(";")[0]!;
}

describe("control-plane auth (#1)", () => {
  it("keeps health public and everything else behind a session", async () => {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json()).toEqual({ authenticated: false });
    const sessions = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(sessions.statusCode).toBe(401);
  });

  it("rejects invalid tokens and accepts the bootstrap token", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { token: "nope" } });
    expect(bad.statusCode).toBe(401);
    const cookie = await login();
    expect(cookie).toContain("pi_control_session=");
    const status = await app.inject({ method: "GET", url: "/api/auth/status", headers: { cookie } });
    expect(status.json()).toEqual({ authenticated: true });
  });

  it("authorizes API access with a valid session cookie", async () => {
    const cookie = await login();
    const res = await app.inject({ method: "GET", url: "/api/sessions", headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });

  it("rejects foreign Host headers", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health", headers: { host: "evil.example" } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden_host" });
  });

  it("rejects foreign Origin headers", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { token: TOKEN },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("logs out and invalidates the session", async () => {
    const cookie = await login();
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/api/sessions", headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });
});
