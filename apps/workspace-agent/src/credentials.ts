/**
 * Credential env-var boundary (ADR-0010, issue #5).
 *
 * Provider keys are applied to the AGENT process so the Pi SDK can use
 * them. Interactive terminals, one-shot exec commands, and supervised
 * processes must NOT inherit them: anything a user runs in the workspace
 * could otherwise read provider API keys. Pi's own tool executions run
 * inside the agent process and keep the keys.
 */

/** Known provider credential variables (Pi providers + common tokens). */
const KNOWN_CREDENTIAL_VARS = new Set([
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "TOGETHER_API_KEY",
  "XAI_API_KEY",
  "PERPLEXITY_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OLLAMA_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACE_TOKEN",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
]);

/** Convention backstop: whole segments like *_API_KEY, *_TOKEN, *_SECRET. */
const CREDENTIAL_PATTERN = /(^|_)(API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(_|$)/i;

/** Normalize camelCase to UPPER_SNAKE so `authToken` matches `_TOKEN`. */
function normalizeVarName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

export function isCredentialVar(name: string): boolean {
  const upper = name.toUpperCase();
  if (KNOWN_CREDENTIAL_VARS.has(upper)) return true;
  return CREDENTIAL_PATTERN.test(normalizeVarName(name));
}

/**
 * Child environment for user-launched processes: the agent's process.env
 * with credential variables removed (extra user-supplied vars are kept as
 * the caller explicitly chose them).
 */
export function scrubbedChildEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !isCredentialVar(key)) env[key] = value;
  }
  return { ...env, ...extra };
}
