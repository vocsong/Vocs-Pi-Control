import { z } from "zod";
import { PROVIDER_KEY_FIELDS, type SettingsService } from "../settings/service.js";
import type { AppFastify } from "../types.js";

const providerKeysBody = z
  .object({
    keys: z.record(z.enum(PROVIDER_KEY_FIELDS), z.string().max(4000)),
  })
  .strict();

const defaultsBody = z
  .object({
    defaultModel: z.string().max(300).nullable().optional(),
    defaultThinkingLevel: z.string().max(50).nullable().optional(),
  })
  .strict();

export function registerSettingsRoutes(app: AppFastify, settings: SettingsService, reconnectAgents: () => void): void {
  app.get("/api/settings", async () => {
    return { settings: settings.snapshot() };
  });

  app.put("/api/settings/providers", async (request, reply) => {
    const body = providerKeysBody.parse(request.body);
    settings.saveProviderKeys(body.keys);
    // Reconnect agents so the updated credentials are forwarded at hello.
    reconnectAgents();
    return { ok: true, settings: settings.snapshot() };
  });

  app.put("/api/settings/defaults", async (request, reply) => {
    const body = defaultsBody.parse(request.body);
    settings.saveDefaults(body);
    return { ok: true, settings: settings.snapshot() };
  });

  app.put("/api/settings/root", async (request, reply) => {
    const body = z.object({ path: z.string().max(4096).nullable() }).strict().parse(request.body);
    try {
      settings.setRootFolder(body.path);
      return { ok: true, rootFolder: settings.rootFolder() };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
