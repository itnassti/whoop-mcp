import { describe, it, expect, vi } from "vitest";
import { TokenStore } from "../src/auth/token-store.js";
import { encrypt, decrypt } from "../src/crypto.js";
import { getDb, schema } from "../src/db/client.js";
import type { WhoopTokenSet } from "../src/whoop/types.js";

const key = "a".repeat(64);

type FakeRow = {
  userId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: Date;
  scopes: string[];
  updatedAt: Date;
};

/**
 * Minimal fake db supporting only the exact Drizzle chains TokenStore.getValidAccessToken
 * calls: db.select().from(...).where(...) -> Promise<[row]>, and
 * db.update(...).set(...).where(...) -> mutates the row in place (simulating persistence).
 */
function fakeDb(row: FakeRow) {
  return {
    select: () => ({
      from: () => ({
        where: async () => [row],
      }),
    }),
    update: () => ({
      set: (patch: Partial<FakeRow>) => ({
        where: async () => {
          Object.assign(row, patch);
        },
      }),
    }),
  };
}

describe("TokenStore.getValidAccessToken (fake db)", () => {
  it("returns stored token when not expired, without calling refresh", async () => {
    const row: FakeRow = {
      userId: "user-1",
      accessTokenEnc: encrypt("current-access", key),
      refreshTokenEnc: encrypt("some-refresh", key),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scopes: ["offline"],
      updatedAt: new Date(),
    };
    const refresh = vi.fn();
    const store = new TokenStore(fakeDb(row) as any, key, refresh);

    const at = await store.getValidAccessToken("user-1");

    expect(at).toBe("current-access");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes and persists re-encrypted tokens when expired", async () => {
    const row: FakeRow = {
      userId: "user-1",
      accessTokenEnc: encrypt("old-access", key),
      refreshTokenEnc: encrypt("old-refresh", key),
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      scopes: ["offline"],
      updatedAt: new Date(),
    };
    const refresh = vi.fn(
      async (): Promise<WhoopTokenSet> => ({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: ["offline"],
      }),
    );
    const store = new TokenStore(fakeDb(row) as any, key, refresh);

    const at = await store.getValidAccessToken("user-1");

    expect(at).toBe("new-access");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("old-refresh");
    expect(decrypt(row.refreshTokenEnc, key)).toBe("new-refresh");
    expect(row.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("TokenStore.forceRefreshAccessToken (fake db)", () => {
  it("unconditionally refreshes and persists even when the stored token is not expired", async () => {
    const row: FakeRow = {
      userId: "user-1",
      accessTokenEnc: encrypt("current-access", key),
      refreshTokenEnc: encrypt("current-refresh", key),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000), // far in the future, NOT expired
      scopes: ["offline"],
      updatedAt: new Date(),
    };
    const refresh = vi.fn(
      async (): Promise<WhoopTokenSet> => ({
        accessToken: "forced-new-access",
        refreshToken: "forced-new-refresh",
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: ["offline"],
      }),
    );
    const store = new TokenStore(fakeDb(row) as any, key, refresh);

    const at = await store.forceRefreshAccessToken("user-1");

    expect(at).toBe("forced-new-access");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("current-refresh");
    expect(decrypt(row.accessTokenEnc, key)).toBe("forced-new-access");
    expect(decrypt(row.refreshTokenEnc, key)).toBe("forced-new-refresh");
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("TokenStore integration (real db)", () => {
  it("upsertUserAndTokens then getValidAccessToken round-trips through Postgres", async () => {
    const db = getDb(url!);
    const refresh = vi.fn();
    const store = new TokenStore(db, key, refresh);
    const whoopUserId = "whoop_" + Math.random().toString(36).slice(2);

    const userId = await store.upsertUserAndTokens(whoopUserId, "a@b.com", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: ["offline"],
    });

    const at = await store.getValidAccessToken(userId);
    expect(at).toBe("access-1");
    expect(refresh).not.toHaveBeenCalled();

    await store.deleteUser(userId);
  });

  it("issue/resolve/revoke mcp token round-trips through Postgres", async () => {
    const db = getDb(url!);
    const store = new TokenStore(db, key, vi.fn());
    const whoopUserId = "whoop_" + Math.random().toString(36).slice(2);
    const userId = await store.upsertUserAndTokens(whoopUserId, null, {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: ["offline"],
    });

    const raw = await store.issueMcpToken(userId, "pat", "test token");
    const resolved = await store.resolveMcpToken(raw);
    expect(resolved).toEqual({ userId });

    await store.revokeMcpToken(raw);
    const afterRevoke = await store.resolveMcpToken(raw);
    expect(afterRevoke).toBeNull();

    const unknown = await store.resolveMcpToken("whoopmcp_pat_bogus");
    expect(unknown).toBeNull();

    await store.deleteUser(userId);
  });
});
