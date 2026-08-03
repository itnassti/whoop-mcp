import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { encrypt, decrypt } from "../crypto.js";
import { refreshWhoopTokens } from "../whoop/oauth.js";
import type { WhoopTokenSet } from "../whoop/types.js";
import { tokenFilePath } from "./paths.js";

type Creds = { clientId: string; clientSecret: string };
type RefreshFn = (refreshToken: string, creds: Creds) => Promise<WhoopTokenSet>;
const EXPIRY_SKEW_MS = 60_000;

export function deriveKeyHex(clientSecret: string): string {
  return createHash("sha256").update("whoop-mcp-token-key:" + clientSecret).digest("hex");
}

export class LocalTokenStore {
  private keyHex: string;
  constructor(private dir: string, private creds: Creds, private refreshFn: RefreshFn = refreshWhoopTokens) {
    this.keyHex = deriveKeyHex(creds.clientSecret);
  }

  save(t: WhoopTokenSet): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const plain = JSON.stringify({ ...t, expiresAt: t.expiresAt.toISOString() });
    writeFileSync(tokenFilePath(this.dir), encrypt(plain, this.keyHex), { mode: 0o600 });
  }

  load(): WhoopTokenSet | null {
    const p = tokenFilePath(this.dir);
    if (!existsSync(p)) return null;
    const o = JSON.parse(decrypt(readFileSync(p, "utf8"), this.keyHex));
    return { ...o, expiresAt: new Date(o.expiresAt) };
  }

  async getValidAccessToken(): Promise<string> {
    const t = this.load();
    if (!t) throw new Error("WHOOP not connected. Run the whoop_login tool first.");
    if (t.expiresAt.getTime() - Date.now() > EXPIRY_SKEW_MS) return t.accessToken;
    return this.refreshAndStore(t.refreshToken);
  }

  async forceRefreshAccessToken(): Promise<string> {
    const t = this.load();
    if (!t) throw new Error("WHOOP not connected. Run the whoop_login tool first.");
    return this.refreshAndStore(t.refreshToken);
  }

  private async refreshAndStore(refreshToken: string): Promise<string> {
    const refreshed = await this.refreshFn(refreshToken, this.creds);
    this.save(refreshed);
    return refreshed.accessToken;
  }
}
