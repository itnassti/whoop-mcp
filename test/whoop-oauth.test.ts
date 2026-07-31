import { describe, it, expect, vi } from "vitest";
import { exchangeCodeForTokens, refreshWhoopTokens } from "../src/whoop/oauth.js";
const creds = { clientId: "id", clientSecret: "secret" };
function mockFetch(json: any) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }));
}

describe("whoop oauth", () => {
  it("maps token response to WhoopTokenSet with absolute expiry", async () => {
    const f = mockFetch({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "offline read:sleep" });
    const before = Date.now();
    const t = await exchangeCodeForTokens("code", "https://cb", creds, "verifier", f as any);
    expect(t.accessToken).toBe("a");
    expect(t.refreshToken).toBe("r");
    expect(t.scopes).toContain("read:sleep");
    expect(t.expiresAt.getTime()).toBeGreaterThan(before + 3500_000);
  });
  it("throws on non-200", async () => {
    const f = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(refreshWhoopTokens("r", creds, f as any)).rejects.toThrow();
  });
});
