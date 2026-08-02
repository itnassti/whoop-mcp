import { describe, it, expect, vi } from "vitest";
import { WhoopOAuthProvider } from "../src/auth/oauth-provider.js";

function makeProvider(resolveMcpToken: ReturnType<typeof vi.fn>) {
  const tokenStore = { resolveMcpToken } as any;
  return new WhoopOAuthProvider({
    tokenStore,
    credentials: {} as any,
    db: {} as any,
    publicBaseUrl: "https://mcp.example.com",
  });
}

describe("WhoopOAuthProvider.verifyAccessToken", () => {
  it("returns AuthInfo whose extra.userId is the resolved userId for a valid token", async () => {
    const resolve = vi.fn(async () => ({ userId: "u1" }));
    const p = makeProvider(resolve);
    const info = await p.verifyAccessToken("tok");
    expect(resolve).toHaveBeenCalledWith("tok");
    expect(info.token).toBe("tok");
    expect(info.extra?.userId).toBe("u1");
    // SDK's requireBearerAuth hard-requires a numeric expiresAt in the future.
    expect(typeof info.expiresAt).toBe("number");
    expect(info.expiresAt!).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("throws for an unknown token (resolve returns null)", async () => {
    const resolve = vi.fn(async () => null);
    const p = makeProvider(resolve);
    await expect(p.verifyAccessToken("bad")).rejects.toThrow();
  });
});

describe("WhoopOAuthProvider.exchangeAuthorizationCode (redirect_uri check)", () => {
  const baseRow = {
    clientId: "client-1",
    userId: "u1",
    redirectUri: "https://client.example/cb",
    codeChallenge: "c",
    scopes: ["mcp"],
    expiresAt: new Date(Date.now() + 60_000),
  };
  const client = { client_id: "client-1" } as any;

  function providerWithCode(issueMcpToken: ReturnType<typeof vi.fn>) {
    const db = {
      select: () => ({ from: () => ({ where: async () => [{ ...baseRow }] }) }),
      delete: () => ({ where: async () => undefined }),
    };
    return new WhoopOAuthProvider({
      tokenStore: { issueMcpToken } as any,
      credentials: {} as any,
      db: db as any,
      publicBaseUrl: "https://mcp.example.com",
    });
  }

  it("throws InvalidGrantError when the token-time redirect_uri does not match", async () => {
    const issueMcpToken = vi.fn(async () => "tok");
    const p = providerWithCode(issueMcpToken);
    await expect(
      p.exchangeAuthorizationCode(client, "code", undefined, "https://evil.example/cb"),
    ).rejects.toThrow(/redirect_uri/i);
    expect(issueMcpToken).not.toHaveBeenCalled();
  });

  it("succeeds when the redirect_uri matches", async () => {
    const issueMcpToken = vi.fn(async () => "tok-123");
    const p = providerWithCode(issueMcpToken);
    const out = await p.exchangeAuthorizationCode(client, "code", undefined, "https://client.example/cb");
    expect(out.access_token).toBe("tok-123");
  });

  it("succeeds when no redirect_uri is supplied (server-internal dashboard path)", async () => {
    const issueMcpToken = vi.fn(async () => "tok-9");
    const p = providerWithCode(issueMcpToken);
    const out = await p.exchangeAuthorizationCode(client, "code");
    expect(out.access_token).toBe("tok-9");
  });
});
