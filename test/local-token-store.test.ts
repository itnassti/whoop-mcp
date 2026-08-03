import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalTokenStore, deriveKeyHex } from "../src/local/token-store.js";
import { localConfigDir } from "../src/local/paths.js";

const creds = { clientId: "id", clientSecret: "sekret" };
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "whoop-local-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const tokenSet = (overrides = {}) => ({
  accessToken: "AT", refreshToken: "RT",
  expiresAt: new Date(Date.now() + 3600_000), scopes: ["offline"], ...overrides,
});

describe("deriveKeyHex", () => {
  it("produces a 32-byte hex key deterministically from the client secret", () => {
    const k = deriveKeyHex("sekret");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveKeyHex("sekret")).toBe(k);
    expect(deriveKeyHex("other")).not.toBe(k);
  });
});

describe("localConfigDir", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    expect(localConfigDir({ XDG_CONFIG_HOME: "/x" } as any)).toBe("/x/whoop-mcp");
  });
});

describe("LocalTokenStore", () => {
  it("save() then load() round-trips the token set and writes a 0600 file", () => {
    const s = new LocalTokenStore(dir, creds);
    const t = tokenSet();
    s.save(t);
    const loaded = s.load()!;
    expect(loaded.accessToken).toBe("AT");
    expect(loaded.refreshToken).toBe("RT");
    expect(new Date(loaded.expiresAt).getTime()).toBe(t.expiresAt.getTime());
    const mode = statSync(join(dir, "tokens.enc")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("load() returns null when no token file exists", () => {
    expect(new LocalTokenStore(dir, creds).load()).toBeNull();
  });

  it("getValidAccessToken() returns the stored token when not expired", async () => {
    const s = new LocalTokenStore(dir, creds);
    s.save(tokenSet());
    expect(await s.getValidAccessToken()).toBe("AT");
  });

  it("getValidAccessToken() refreshes + persists when expired", async () => {
    const refreshed = tokenSet({ accessToken: "AT2", refreshToken: "RT2" });
    const refreshFn = async (rt: string) => { expect(rt).toBe("RT"); return refreshed; };
    const s = new LocalTokenStore(dir, creds, refreshFn as any);
    s.save(tokenSet({ expiresAt: new Date(Date.now() - 1000) }));
    expect(await s.getValidAccessToken()).toBe("AT2");
    expect(s.load()!.refreshToken).toBe("RT2"); // persisted
  });

  it("getValidAccessToken() throws a clear error when not connected", async () => {
    await expect(new LocalTokenStore(dir, creds).getValidAccessToken())
      .rejects.toThrow(/whoop_login/i);
  });
});
