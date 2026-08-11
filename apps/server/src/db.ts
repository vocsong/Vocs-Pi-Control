import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, schema, type Db } from "@pi-control/database";
import { eq } from "drizzle-orm";
import { nowIso } from "@pi-control/shared";

/** The V1 control-plane machine record for the local host. */
export const LOCAL_MACHINE_ID = "machine_local";

export function openDatabase(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  return openDb(dbPath);
}

/** Ensure the local machine record exists (plan §4.1). */
export function ensureLocalMachine(db: Db): void {
  const existing = db
    .select()
    .from(schema.machines)
    .where(eq(schema.machines.id, LOCAL_MACHINE_ID))
    .get();
  if (existing) return;
  db.insert(schema.machines)
    .values({
      id: LOCAL_MACHINE_ID,
      name: "Local machine",
      kind: "local",
      hostname: hostname(),
      platform: process.platform,
      status: "online",
      capabilitiesJson: JSON.stringify({ sandbox: "mock" }),
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
    })
    .run();
}

function hostname(): string {
  try {
    return os.hostname();
  } catch {
    return "local";
  }
}
