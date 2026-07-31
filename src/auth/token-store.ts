import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "../crypto.js";
import { schema } from "../db/client.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { WhoopTokenSet } from "../whoop/types.js";

export type RefreshFn = (refreshToken: string) => Promise<WhoopTokenSet>;
type Db = NodePgDatabase<typeof schema>;
const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");
const EXPIRY_SKEW_MS = 60_000;

export class TokenStore {
  constructor(private db: Db, private keyHex: string, private refresh: RefreshFn) {}

  async upsertUserAndTokens(whoopUserId: string, email: string | null, t: WhoopTokenSet): Promise<string> {
    const [user] = await this.db.insert(schema.users)
      .values({ whoopUserId, email })
      .onConflictDoUpdate({ target: schema.users.whoopUserId, set: { email } })
      .returning();
    await this.db.insert(schema.whoopTokens).values({
      userId: user.id,
      accessTokenEnc: encrypt(t.accessToken, this.keyHex),
      refreshTokenEnc: encrypt(t.refreshToken, this.keyHex),
      accessTokenExpiresAt: t.expiresAt, scopes: t.scopes,
    }).onConflictDoUpdate({
      target: schema.whoopTokens.userId,
      set: {
        accessTokenEnc: encrypt(t.accessToken, this.keyHex),
        refreshTokenEnc: encrypt(t.refreshToken, this.keyHex),
        accessTokenExpiresAt: t.expiresAt, scopes: t.scopes, updatedAt: new Date(),
      },
    });
    return user.id;
  }

  async getValidAccessToken(userId: string): Promise<string> {
    const [row] = await this.db.select().from(schema.whoopTokens)
      .where(eq(schema.whoopTokens.userId, userId));
    if (!row) throw new Error("WHOOP not connected");
    if (row.accessTokenExpiresAt.getTime() - Date.now() > EXPIRY_SKEW_MS) {
      return decrypt(row.accessTokenEnc, this.keyHex);
    }
    return this.refreshAndStore(userId, row.refreshTokenEnc);
  }

  async forceRefreshAccessToken(userId: string): Promise<string> {
    const [row] = await this.db.select().from(schema.whoopTokens)
      .where(eq(schema.whoopTokens.userId, userId));
    if (!row) throw new Error("WHOOP not connected");
    return this.refreshAndStore(userId, row.refreshTokenEnc);
  }

  private async refreshAndStore(userId: string, encryptedRefreshToken: string): Promise<string> {
    const refreshed = await this.refresh(decrypt(encryptedRefreshToken, this.keyHex));
    await this.db.update(schema.whoopTokens).set({
      accessTokenEnc: encrypt(refreshed.accessToken, this.keyHex),
      refreshTokenEnc: encrypt(refreshed.refreshToken, this.keyHex),
      accessTokenExpiresAt: refreshed.expiresAt, scopes: refreshed.scopes, updatedAt: new Date(),
    }).where(eq(schema.whoopTokens.userId, userId));
    return refreshed.accessToken;
  }

  async issueMcpToken(userId: string, type: "oauth" | "pat", label?: string): Promise<string> {
    const raw = `whoopmcp_${type}_${randomBytes(32).toString("base64url")}`;
    await this.db.insert(schema.mcpTokens).values({ tokenHash: hashToken(raw), userId, type, label });
    return raw;
  }

  async resolveMcpToken(raw: string): Promise<{ userId: string } | null> {
    const [row] = await this.db.select().from(schema.mcpTokens)
      .where(eq(schema.mcpTokens.tokenHash, hashToken(raw)));
    if (!row || row.revokedAt) return null;
    await this.db.update(schema.mcpTokens).set({ lastUsedAt: new Date() })
      .where(eq(schema.mcpTokens.tokenHash, row.tokenHash));
    return { userId: row.userId };
  }

  async revokeMcpToken(raw: string): Promise<void> {
    await this.db.update(schema.mcpTokens).set({ revokedAt: new Date() })
      .where(eq(schema.mcpTokens.tokenHash, hashToken(raw)));
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.delete(schema.users).where(eq(schema.users.id, userId)); // cascades
  }
}
