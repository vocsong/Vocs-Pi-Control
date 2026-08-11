/**
 * Agent configuration from the environment.
 *
 * Injected by the control server at container creation:
 *   PI_CONTROL_AGENT_TOKEN   per-sandbox secret (required for auth)
 *   PI_CONTROL_AGENT_PORT    port the agent listens on INSIDE the sandbox
 *   PI_CONTROL_WORKSPACE_ID  control-plane workspace id
 * Container image defaults apply when running ad-hoc.
 */

export interface AgentConfig {
  host: string;
  port: number;
  token: string | null;
  workspaceId: string;
  agentVersion: string;
}

export const AGENT_VERSION = "0.0.0";

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    // Inside a container the agent must bind 0.0.0.0: published ports are
    // loopback-only on the host, so this is not public exposure. Host-based
    // development keeps the default 127.0.0.1.
    host: env.PI_CONTROL_AGENT_HOST ?? "127.0.0.1",
    port: Number(env.PI_CONTROL_AGENT_PORT ?? 4175),
    token: env.PI_CONTROL_AGENT_TOKEN ?? null,
    workspaceId: env.PI_CONTROL_WORKSPACE_ID ?? "workspace_unknown",
    agentVersion: AGENT_VERSION,
  };
}
