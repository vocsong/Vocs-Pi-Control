/**
 * LeaseManager — browser editing lease per session (plan §27).
 *
 * Many observers may watch a session, but one client is the primary
 * controller. The lease:
 *   - is granted to one client per session (first take wins);
 *   - expires automatically if the holder disappears (TTL + heartbeat);
 *   - can be taken over explicitly (force) by another client;
 *   - never blocks OTHER Pi sessions in the same workspace;
 *   - the server remains authoritative (leases are advisory for UI
 *     enablement, and prompt enforcement uses them when enabled).
 */

export interface Lease {
  sessionId: string;
  holder: string | null;
  expiresAt: number | null;
}

export interface LeaseManagerOptions {
  /** Lease TTL in ms. Default 30s. */
  ttlMs?: number;
  /** Enforce the lease for prompts (reject non-holders). Default false. */
  enforcePrompts?: boolean;
}

export class LeaseManager {
  private readonly leases = new Map<string, Lease>();
  private readonly ttlMs: number;
  private readonly enforcePrompts: boolean;

  constructor(options: LeaseManagerOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.enforcePrompts = options.enforcePrompts ?? false;
  }

  /** Take the lease. Returns the resulting lease (holder = clientId). */
  take(sessionId: string, clientId: string, force = false): Lease {
    this.expire(sessionId);
    const current = this.leases.get(sessionId);
    if (current?.holder && current.holder !== clientId && !force) {
      return current;
    }
    const lease: Lease = { sessionId, holder: clientId, expiresAt: Date.now() + this.ttlMs };
    this.leases.set(sessionId, lease);
    return lease;
  }

  /** Renew the holder's lease (heartbeat). No-op when held by another. */
  heartbeat(sessionId: string, clientId: string): Lease | null {
    this.expire(sessionId);
    const current = this.leases.get(sessionId);
    if (!current) {
      return this.take(sessionId, clientId);
    }
    if (current.holder !== clientId) return current;
    current.expiresAt = Date.now() + this.ttlMs;
    return current;
  }

  release(sessionId: string, clientId: string): Lease | null {
    const current = this.leases.get(sessionId);
    if (current?.holder === clientId) {
      this.leases.delete(sessionId);
      return { sessionId, holder: null, expiresAt: null };
    }
    return current ?? null;
  }

  status(sessionId: string): Lease {
    this.expire(sessionId);
    return this.leases.get(sessionId) ?? { sessionId, holder: null, expiresAt: null };
  }

  /** True when clientId may prompt this session. */
  mayPrompt(sessionId: string, clientId: string): { allowed: boolean; lease: Lease } {
    const lease = this.status(sessionId);
    if (!this.enforcePrompts) return { allowed: true, lease };
    if (!lease.holder || lease.holder === clientId) return { allowed: true, lease };
    return { allowed: false, lease };
  }

  /** Release every lease held by a client (called on socket close). */
  releaseAllFor(clientId: string): string[] {
    const released: string[] = [];
    for (const [sessionId, lease] of this.leases) {
      if (lease.holder === clientId) {
        this.leases.delete(sessionId);
        released.push(sessionId);
      }
    }
    return released;
  }

  /** Number of active leases (diagnostics). */
  count(): number {
    this.expireAll();
    return this.leases.size;
  }

  private expire(sessionId: string): void {
    const current = this.leases.get(sessionId);
    if (current?.holder && current.expiresAt !== null && Date.now() > current.expiresAt) {
      this.leases.delete(sessionId);
    }
  }

  private expireAll(): void {
    const now = Date.now();
    for (const [sessionId, lease] of this.leases) {
      if (lease.holder && lease.expiresAt !== null && now > lease.expiresAt) {
        this.leases.delete(sessionId);
      }
    }
  }
}
