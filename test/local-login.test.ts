import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pkcePair, startLogin, completeLogin } from "../src/local/login.js";
import { LocalTokenStore } from "../src/local/token-store.js";

const creds = { clientId: "id", clientSecret: "sekret" };
const redirectUri = "https://example.github.io/whoop-mcp/callback/";
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "whoop-login-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("pkcePair", () => {
  it("returns a URL-safe verifier and a base64url S256 challenge", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });
});

describe("startLogin + completeLogin", () => {
  it("startLogin returns an authorize URL carrying client_id, redirect_uri, S256 and state", () => {
    const { authorizeUrl } = startLogin(dir, { clientId: "id", redirectUri });
    const u = new URL(authorizeUrl);
    expect(u.searchParams.get("client_id")).toBe("id");
    expect(u.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBeTruthy();
  });

  it("completeLogin rejects a mismatched state", async () => {
    startLogin(dir, { clientId: "id", redirectUri });
    const store = new LocalTokenStore(dir, creds);
    await expect(completeLogin(dir, { code: "c", state: "WRONG", creds, redirectUri, store }))
      .rejects.toThrow(/state/i);
  });

  it("completeLogin exchanges the code and saves tokens", async () => {
    const { authorizeUrl } = startLogin(dir, { clientId: "id", redirectUri });
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    const exchange = (async (code: string, ru: string, c: any, verifier: string) => {
      expect(code).toBe("the-code"); expect(ru).toBe(redirectUri);
      expect(c.clientSecret).toBe("sekret"); expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      return { accessToken: "AT", refreshToken: "RT", expiresAt: new Date(Date.now()+3600_000), scopes: ["offline"] };
    }) as any;
    const store = new LocalTokenStore(dir, creds);
    await completeLogin(dir, { code: "the-code", state, creds, redirectUri, store, exchange });
    expect(store.load()!.accessToken).toBe("AT");
  });
});
