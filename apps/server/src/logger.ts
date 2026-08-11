import pino from "pino";

/**
 * Structured logger with secret redaction.
 * Never log full prompts, tool outputs, environments or secrets by default
 * (plan §42.5).
 */
export function createLogger(level: string): pino.Logger {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.token",
        "*.secret",
        "*.apiKey",
        "*.password",
        "*.credential",
      ],
      censor: "[redacted]",
    },
  });
}

export type Logger = pino.Logger;
