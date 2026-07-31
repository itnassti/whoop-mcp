import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { schema } from "../db/client.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { TokenStore } from "./token-store.js";
import type { CredentialProvider } from "../whoop/credentials.js";
import { buildAuthorizeUrl } from "../whoop/oauth.js";

type Db = NodePgDatabase<typeof schema>;

export interface ProviderDeps {
  tokenStore: TokenStore;
  credentials: CredentialProvider;
  db: Db;
  publicBaseUrl: string;
}

const sha256hex = (raw: string) => createHash("sha256").update(raw).digest("hex");
const base64url = (buf: Buffer) => buf.toString("base64url");
const pkceChallenge = (verifier: string) =>
  base64url(createHash("sha256").update(verifier).digest());

const PENDING_TTL_MS = 10 * 60_000;

// Payload persisted for the WHOOP leg of the flow, keyed by whoopState.
export interface PendingPayload extends Record<string, unknown> {
  clientId: string;
  clientRedirectUri: string;
  clientState?: string;
  clientCodeChallenge: string;
  scopes: string[];
  whoopCodeVerifier: string;
}

export class WhoopOAuthProvider implements OAuthServerProvider {
  constructor(private deps: ProviderDeps) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    const db = this.deps.db;
    return {
      async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
        const [row] = await db
          .select()
          .from(schema.oauthClients)
          .where(eq(schema.oauthClients.clientId, clientId));
        if (!row) return undefined;
        return {
          ...(row.metadata as Record<string, unknown>),
          client_id: row.clientId,
          redirect_uris: row.redirectUris,
        } as OAuthClientInformationFull;
      },
      async registerClient(client): Promise<OAuthClientInformationFull> {
        const full = client as OAuthClientInformationFull;
        await db.insert(schema.oauthClients).values({
          clientId: full.client_id,
          clientSecretHash: full.client_secret ? sha256hex(full.client_secret) : null,
          redirectUris: full.redirect_uris,
          metadata: full as unknown as Record<string, unknown>,
        });
        return full;
      },
    };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const whoopState = base64url(randomBytes(32));
    const whoopCodeVerifier = base64url(randomBytes(32));

    const payload: PendingPayload = {
      clientId: client.client_id,
      clientRedirectUri: params.redirectUri,
      clientState: params.state,
      clientCodeChallenge: params.codeChallenge,
      scopes: params.scopes ?? [],
      whoopCodeVerifier,
    };

    await this.deps.db.insert(schema.pendingAuthorizations).values({
      whoopState,
      payload,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    });

    const creds = await this.deps.credentials.getClientCredentials();
    const url = buildAuthorizeUrl({
      clientId: creds.clientId,
      redirectUri: `${this.deps.publicBaseUrl}/whoop/callback`,
      state: whoopState,
      codeChallenge: pkceChallenge(whoopCodeVerifier),
    });
    res.redirect(302, url);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const [row] = await this.deps.db
      .select()
      .from(schema.oauthAuthCodes)
      .where(eq(schema.oauthAuthCodes.codeHash, sha256hex(authorizationCode)));
    if (!row) throw new Error("invalid_grant");
    return row.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const codeHash = sha256hex(authorizationCode);
    const [row] = await this.deps.db
      .select()
      .from(schema.oauthAuthCodes)
      .where(eq(schema.oauthAuthCodes.codeHash, codeHash));
    if (!row) throw new Error("invalid_grant");
    // Single-use: delete regardless of outcome below.
    await this.deps.db
      .delete(schema.oauthAuthCodes)
      .where(eq(schema.oauthAuthCodes.codeHash, codeHash));
    if (row.clientId !== client.client_id) throw new Error("invalid_grant");
    if (row.expiresAt.getTime() < Date.now()) throw new Error("invalid_grant");

    const accessToken = await this.deps.tokenStore.issueMcpToken(row.userId, "oauth");
    return { access_token: accessToken, token_type: "bearer" };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error("unsupported_grant_type");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const r = await this.deps.tokenStore.resolveMcpToken(token);
    if (!r) throw new Error("invalid_token");
    return { token, clientId: "mcp", scopes: ["mcp"], extra: { userId: r.userId } };
  }
}
