/**
 * Auth REST routes (ADR-0008, issue #1): status probe, bootstrap-token
 * login, logout. Login exchanges the one-time bootstrap token for an
 * HttpOnly SameSite=Strict session cookie.
 */

import crypto from "node:crypto";
import { z } from "zod";
import type { AppFastify } from "../types.js";
import type { SessionStore } from "./store.js";
import { parseCookies, SESSION_COOKIE } from "./guard.js";

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export interface AuthRouteDeps {
  sessions: SessionStore;
  token: string;
}

export function registerAuthRoutes(app: AppFastify, deps: AuthRouteDeps): void {
  app.get("/api/auth/status", async (request) => {
    const cookie = parseCookies(request.headers.cookie ?? "");
    return { authenticated: deps.sessions.validate(cookie[SESSION_COOKIE]) };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = z.object({ token: z.string().min(1).max(256) }).strict().parse(request.body);
    if (!safeEqual(body.token, deps.token)) {
      return reply.code(401).send({ error: "invalid_token" });
    }
    const sid = deps.sessions.create();
    return reply
      .header(
        "set-cookie",
        `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}`,
      )
      .send({ ok: true });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const cookie = parseCookies(request.headers.cookie ?? "");
    deps.sessions.destroy(cookie[SESSION_COOKIE]);
    return reply
      .header("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
      .send({ ok: true });
  });
}
