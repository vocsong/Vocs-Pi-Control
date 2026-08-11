import type { SessionInfo } from "@pi-control/protocol";

export interface HealthInfo {
  status: string;
  service: string;
  version: string;
  uptimeMs: number;
  runtime: string;
  database: string;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => json<HealthInfo>("/api/health"),

  listSessions: () => json<{ sessions: SessionInfo[] }>("/api/sessions"),

  createSession: (body: { title?: string } = {}) =>
    json<{ session: SessionInfo }>("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
};
