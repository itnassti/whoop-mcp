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
  });

  it("throws for an unknown token (resolve returns null)", async () => {
    const resolve = vi.fn(async () => null);
    const p = makeProvider(resolve);
    await expect(p.verifyAccessToken("bad")).rejects.toThrow();
  });
});
