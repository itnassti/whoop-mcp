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

  it("derives PUBLIC_BASE_URL from RAILWAY_PUBLIC_DOMAIN when unset", () => {
    const { PUBLIC_BASE_URL, ...rest } = base;
    const c = loadConfig({ ...rest, RAILWAY_PUBLIC_DOMAIN: "app.up.railway.app" } as any);
    expect(c.publicBaseUrl).toBe("https://app.up.railway.app");
  });

  it("treats an empty PUBLIC_BASE_URL as unset and derives from RAILWAY_PUBLIC_DOMAIN", () => {
    const c = loadConfig({ ...base, PUBLIC_BASE_URL: "", RAILWAY_PUBLIC_DOMAIN: "app.up.railway.app" } as any);
    expect(c.publicBaseUrl).toBe("https://app.up.railway.app");
  });

  it("prefers explicit PUBLIC_BASE_URL over RAILWAY_PUBLIC_DOMAIN", () => {
    const c = loadConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: "other.up.railway.app" } as any);
    expect(c.publicBaseUrl).toBe("https://example.com");
  });

  it("throws when neither PUBLIC_BASE_URL nor RAILWAY_PUBLIC_DOMAIN is set", () => {
    const { PUBLIC_BASE_URL, ...rest } = base;
    expect(() => loadConfig(rest as any)).toThrow();
  });

  it("parses ALLOWED_WHOOP_EMAILS into a trimmed, lowercased list (empty when unset)", () => {
    expect(loadConfig(base as any).allowedWhoopEmails).toEqual([]);
    const c = loadConfig({ ...base, ALLOWED_WHOOP_EMAILS: "a@b.com,  C@D.com , " } as any);
    expect(c.allowedWhoopEmails).toEqual(["a@b.com", "c@d.com"]);
  });

  it("parses RESTRICT_ACCESS as a boolean, default false", () => {
    expect(loadConfig(base as any).restrictAccess).toBe(false);
    expect(loadConfig({ ...base, RESTRICT_ACCESS: "true" } as any).restrictAccess).toBe(true);
    expect(loadConfig({ ...base, RESTRICT_ACCESS: "1" } as any).restrictAccess).toBe(true);
    expect(loadConfig({ ...base, RESTRICT_ACCESS: "false" } as any).restrictAccess).toBe(false);
  });
});
