/**
 * SettingsService — control-plane settings (plan §34: Providers,
 * Authentication, Models).
 *
 * Provider API keys are stored in the local SQLite settings table and
 * applied to the server environment + forwarded to workspace agents at
 * hello time (V1 credential boundary, ADR-0010). Values are never
 * returned by the API — only configured/not.
 */

import fs from "node:fs";
import { schema, type Db } from "@pi-control/database";
import { eq } from "drizzle-orm";
import type { Logger } from "../logger.js";

export const PROVIDER_KEY_FIELDS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "TOGETHER_API_KEY",
  "PERPLEXITY_API_KEY",
] as const;

export type ProviderKeyField = (typeof PROVIDER_KEY_FIELDS)[number];

const KEY_PREFIX = "providers.";
const DEFAULTS_KEY = "session.defaults";
const ROOT_FOLDER_KEY = "root.folder";

export interface ProviderStatus {
  key: ProviderKeyField;
  configured: boolean;
}

export interface SessionDefaults {
  defaultModel: string | null;
  defaultThinkingLevel: string | null;
  /** Keep completed thinking blocks expanded by default. */
  showThinkingByDefault: boolean;
}

export interface SettingsSnapshot {
  providers: ProviderStatus[];
  defaults: SessionDefaults;
  /** Root folder: every project/workspace must live inside it (when set). */
  rootFolder: string | null;
}

export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    /** Fallback root folder used when none is stored (default <dataDir>/workspaces). */
    private readonly defaultRootFolder: string,
  ) {
    // Make sure the default root exists.
    fs.mkdirSync(this.defaultRootFolder, { recursive: true });
  }

  /** Apply stored provider keys into the server environment (startup). */
  applyStoredKeysToEnv(): void {
    for (const field of PROVIDER_KEY_FIELDS) {
      const value = this.getSetting(`${KEY_PREFIX}${field}`);
      if (value) process.env[field] = value;
    }
  }

  /** Keys available to forward to workspace agents (env + stored). */
  providerEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of PROVIDER_KEY_FIELDS) {
      const value = process.env[field] ?? this.getSetting(`${KEY_PREFIX}${field}`);
      if (value) out[field] = value;
    }
    return out;
  }

  /** Apply the configured root folder from env at startup. */
  applyRootFolderFromEnv(): void {
    const fromEnv = process.env.PI_CONTROL_ROOT_FOLDER;
    if (fromEnv && !this.getSetting(ROOT_FOLDER_KEY)) {
      this.setRootFolder(fromEnv);
    }
  }

  rootFolder(): string {
    return this.getSetting(ROOT_FOLDER_KEY) ?? this.defaultRootFolder;
  }

  /** Set (or clear with empty) the root folder; must be an existing directory. */
  setRootFolder(path: string | null): void {
    if (path && path.trim()) {
      const fs = require("node:fs") as typeof import("node:fs");
      const resolved = fs.realpathSync(path.trim());
      if (!fs.statSync(resolved).isDirectory()) throw new Error(`Not a directory: ${path}`);
      this.setSetting(ROOT_FOLDER_KEY, resolved);
      this.logger.info({ rootFolder: resolved }, "workspace root folder set");
    } else {
      this.deleteSetting(ROOT_FOLDER_KEY);
      this.logger.info("workspace root folder cleared");
    }
  }

  snapshot(): SettingsSnapshot {
    return {
      providers: PROVIDER_KEY_FIELDS.map((key) => ({
        key,
        configured: Boolean(process.env[key] ?? this.getSetting(`${KEY_PREFIX}${key}`)),
      })),
      defaults: this.defaults(),
      rootFolder: this.rootFolder(),
    };
  }

  /** True when a root folder was explicitly stored (vs the default). */
  hasExplicitRoot(): boolean {
    return this.getSetting(ROOT_FOLDER_KEY) !== null;
  }

  defaults(): SessionDefaults {
    const raw = this.getSetting(DEFAULTS_KEY);
    try {
      const parsed = raw ? (JSON.parse(raw) as SessionDefaults) : null;
      return {
        defaultModel: parsed?.defaultModel ?? null,
        defaultThinkingLevel: parsed?.defaultThinkingLevel ?? null,
        showThinkingByDefault: parsed?.showThinkingByDefault ?? false,
      };
    } catch {
      return { defaultModel: null, defaultThinkingLevel: null, showThinkingByDefault: false };
    }
  }

  /** Persist provider keys (empty values remove the stored key). */
  saveProviderKeys(keys: Partial<Record<ProviderKeyField, string>>): void {
    for (const field of PROVIDER_KEY_FIELDS) {
      const value = keys[field];
      if (value === undefined) continue;
      const key = `${KEY_PREFIX}${field}`;
      if (value.trim()) {
        this.setSetting(key, value.trim());
        process.env[field] = value.trim();
        this.logger.info({ provider: field }, "provider key configured");
      } else {
        this.deleteSetting(key);
        delete process.env[field];
        this.logger.info({ provider: field }, "provider key removed");
      }
    }
  }

  saveDefaults(defaults: Partial<SessionDefaults>): void {
    const current = this.defaults();
    const next: SessionDefaults = {
      defaultModel: defaults.defaultModel === undefined ? current.defaultModel : defaults.defaultModel,
      defaultThinkingLevel:
        defaults.defaultThinkingLevel === undefined ? current.defaultThinkingLevel : defaults.defaultThinkingLevel,
      showThinkingByDefault:
        defaults.showThinkingByDefault === undefined ? current.showThinkingByDefault : defaults.showThinkingByDefault,
    };
    this.setSetting(DEFAULTS_KEY, JSON.stringify(next));
  }

  /* ------------------------------------------------------------------ */

  private getSetting(key: string): string | null {
    const row = this.db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
    return row?.value ?? null;
  }

  private setSetting(key: string, value: string): void {
    this.db
      .insert(schema.settings)
      .values({ key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date().toISOString() } })
      .run();
  }

  private deleteSetting(key: string): void {
    this.db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
  }
}
