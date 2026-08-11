/**
 * Database bootstrap: open SQLite, apply migrations, export typed client.
 */

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

/** Path to the package's migrations folder (works from compiled or tsx runs). */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export interface OpenDbOptions {
  /** SQLite pragmas to apply on open. */
  pragmas?: Record<string, string | number>;
  /** Skip running migrations (used by tests that create schema themselves). */
  skipMigrations?: boolean;
}

export function openDb(dbPath: string, options: OpenDbOptions = {}): Db {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  for (const [key, value] of Object.entries(options.pragmas ?? {})) {
    sqlite.pragma(`${key} = ${String(value)}`);
  }

  const db = drizzle(sqlite, { schema });
  if (!options.skipMigrations) {
    migrate(db, { migrationsFolder });
  }
  return db;
}

export { schema };
