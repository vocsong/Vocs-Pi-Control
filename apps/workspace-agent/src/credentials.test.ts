import { describe, expect, it, afterEach } from "vitest";
import { isCredentialVar, scrubbedChildEnv } from "./credentials.js";

const saved: Record<string, string | undefined> = {};
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("credential scrubbing (#5)", () => {
  it("identifies known provider keys", () => {
    expect(isCredentialVar("DEEPSEEK_API_KEY")).toBe(true);
    expect(isCredentialVar("OPENAI_API_KEY")).toBe(true);
    expect(isCredentialVar("ANTHROPIC_API_KEY")).toBe(true);
  });

  it("identifies convention-matching credential vars including camelCase", () => {
    expect(isCredentialVar("MY_SERVICE_TOKEN")).toBe(true);
    expect(isCredentialVar("DB_PASSWORD")).toBe(true);
    expect(isCredentialVar("authToken")).toBe(true);
    expect(isCredentialVar("NPM_REGISTRY_AUTH_TOKEN")).toBe(true);
  });

  it("leaves benign variables alone", () => {
    expect(isCredentialVar("PATH")).toBe(false);
    expect(isCredentialVar("NODE_ENV")).toBe(false);
    expect(isCredentialVar("PI_CONTROL_WORKSPACE_ID")).toBe(false);
    expect(isCredentialVar("HOME")).toBe(false);
  });

  it("removes credential vars from child environments", () => {
    saved.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    saved.MY_SERVICE_TOKEN = process.env.MY_SERVICE_TOKEN;
    saved.PATH = process.env.PATH;
    process.env.DEEPSEEK_API_KEY = "sk-test";
    process.env.MY_SERVICE_TOKEN = "hunter2";
    process.env.PATH = "/usr/bin";
    const env = scrubbedChildEnv();
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(env.MY_SERVICE_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("keeps explicitly supplied spawn env vars", () => {
    saved.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const env = scrubbedChildEnv({ DEEPSEEK_API_KEY: "user-chosen" });
    expect(env.DEEPSEEK_API_KEY).toBe("user-chosen");
  });
});
