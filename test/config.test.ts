import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://x", ENCRYPTION_KEY: "a".repeat(64),
  WHOOP_CLIENT_ID: "id", WHOOP_CLIENT_SECRET: "secret",
  PUBLIC_BASE_URL: "https://example.com", PORT: "8080",
  SESSION_SECRET: "test-session-secret-1234567890",
};

describe("loadConfig", () => {
  it("parses valid env", () => {
    const c = loadConfig(base as any);
    expect(c.port).toBe(8080);
    expect(c.publicBaseUrl).toBe("https://example.com");
  });
  it("throws when ENCRYPTION_KEY is not 64 hex chars", () => {
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: "short" } as any)).toThrow();
  });
  it("throws when a required var is missing", () => {
    const { WHOOP_CLIENT_ID, ...rest } = base;
    expect(() => loadConfig(rest as any)).toThrow();
  });
});
