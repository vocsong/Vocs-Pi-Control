/**
 * Control-plane request guards (ADR-0008, issue #1).
 *
 * - Host allowlist: blocks DNS-rebinding and foreign-Host requests.
 * - Origin allowlist: blocks cross-origin state changes (CSRF) and
 *   cross-origin WebSocket handshakes.
 * - Session check: every /api path except the public allowlist requires a
 *   valid session cookie. /ws is enforced inside the websocket handler
 *   (close code 4401) so the browser client can distinguish an auth
 *   failure from a network drop.
 * - SameSite=Strict cookies already stop cross-site cookie attachment; the
 *   Origin check is defense in depth.
 */

import type { AppFastify } from "../types.js";
import type { SessionStore } from "./store.js";

export const SESSION_COOKIE = "pi_control_session";
/** WebSocket close code sent when the session cookie is missing/expired. */
export const UNAUTHORIZED_WS_CODE = 4401;

export interface AuthDeps {
  sessions: SessionStore;
  /** Bootstrap token the browser must exchange for a session cookie. */
  token: string;
  /** Host header names allowed (lowercase, no port), e.g. 127.0.0.1. */
  allowedHosts: string[];
  /** Origin hostnames allowed for state-changing requests, e.g. 127.0.0.1. */
  allowedOrigins: string[];
  /** /api paths reachable without a session. */
  publicPaths: string[];
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

function hostOf(request: { headers: { host?: string } }): string {
  const host = (request.headers.host ?? "").toLowerCase();
  // IPv6 literal: "[::1]:5174" → "[::1]"
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(0, end + 1) : host;
  }
  return host.split(":")[0] ?? host;
}

export function registerAuthGuards(app: AppFastify, deps: AuthDeps): void {
  app.addHook("onRequest", async (request, reply) => {
    let pathname: string;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      return reply.code(400).send({ error: "bad_request" });
    }

    if (!deps.allowedHosts.includes(hostOf(request))) {
      return reply.code(403).send({ error: "forbidden_host" });
    }

    const origin = request.headers.origin;
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).hostname.toLowerCase();
      } catch {
        return reply.code(403).send({ error: "forbidden_origin" });
      }
      if (!deps.allowedOrigins.includes(originHost)) {
        return reply.code(403).send({ error: "forbidden_origin" });
      }
    }

    // Defense-in-depth headers for anything served through this app.
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");

    if (pathname.startsWith("/api/") && !deps.publicPaths.includes(pathname)) {
      const cookie = parseCookies(request.headers.cookie ?? "");
      if (!deps.sessions.validate(cookie[SESSION_COOKIE])) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }
  });
}
