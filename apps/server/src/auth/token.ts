/**
 * Bootstrap token (ADR-0008, issue #1): the one secret that unlocks the
 * control plane. Generated once and persisted in the local settings table;
 * printed to the server console at startup. The browser exchanges it for a
 * session cookie via POST /api/auth/login.
 */

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@pi-control/database";
import { nowIso } from "@pi-control/shared";

const TOKEN_KEY = "auth.bootstrapToken";

export function getBootstrapToken(db: Db): string {
  const existing = db.select().from(schema.settings).where(eq(schema.settings.key, TOKEN_KEY)).get();
  if (existing?.value) return existing.value;
  const token = crypto.randomBytes(24).toString("base64url");
  db.insert(schema.settings)
    .values({ key: TOKEN_KEY, value: token, updatedAt: nowIso() })
    .onConflictDoNothing()
    .run();
  return token;
}
