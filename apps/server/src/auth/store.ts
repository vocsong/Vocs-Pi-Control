/**
 * Server-side browser session store (ADR-0008, issue #1).
 *
 * Local-first: sessions live in memory, so a server restart invalidates
 * them and the browser must log in again. The session id is carried in an
 * HttpOnly SameSite=Strict cookie; the store itself never sees cookies.
 */

import crypto from "node:crypto";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class SessionStore {
  private readonly sessions = new Map<string, { createdAt: number; lastSeen: number }>();

  create(): string {
    const id = crypto.randomBytes(24).toString("base64url");
    const now = Date.now();
    this.sessions.set(id, { createdAt: now, lastSeen: now });
    return id;
  }

  /** Validate a session id (sliding expiry); false for missing/expired. */
  validate(id: string | undefined): boolean {
    if (!id) return false;
    const session = this.sessions.get(id);
    if (!session) return false;
    const now = Date.now();
    if (now - session.lastSeen > SESSION_TTL_MS) {
      this.sessions.delete(id);
      return false;
    }
    session.lastSeen = now;
    return true;
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }
}
