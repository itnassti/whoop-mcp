import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { schema } from "../db/client.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { TokenStore } from "./token-store.js";
import type { CredentialProvider } from "../whoop/credentials.js";
import { exchangeCodeForTokens } from "../whoop/oauth.js";
import { WhoopClient } from "../whoop/client.js";
import type { PendingPayload } from "./oauth-provider.js";

type Db = NodePgDatabase<typeof schema>;
type FetchImpl = typeof fetch;

export interface CallbackDeps {
  db: Db;
  tokenStore: TokenStore;
  credentials: CredentialProvider;
  publicBaseUrl: string;
  fetchImpl?: FetchImpl;
}

const sha256hex = (raw: string) => createHash("sha256").update(raw).digest("hex");
const AUTH_CODE_TTL_MS = 5 * 60_000;

export function createWhoopCallbackRouter(deps: CallbackDeps): Router {
  const router = Router();
  const fetchImpl = deps.fetchImpl ?? fetch;

  router.get("/whoop/callback", async (req: Request, res: Response) => {
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const error = typeof req.query.error === "string" ? req.query.error : undefined;

    if (error) {
      res.status(400).send("WHOOP authorization failed.");
      return;
    }
    if (!state || !code) {
      res.status(400).send("Missing state or code.");
      return;
    }

    const [pending] = await deps.db
      .select()
      .from(schema.pendingAuthorizations)
      .where(eq(schema.pendingAuthorizations.whoopState, state));

    if (!pending || pending.expiresAt.getTime() < Date.now()) {
      res.status(400).send("Unknown or expired authorization request.");
      return;
    }

    // Single-use pending record.
    await deps.db
      .delete(schema.pendingAuthorizations)
      .where(eq(schema.pendingAuthorizations.whoopState, state));

    const payload = pending.payload as PendingPayload;
    const creds = await deps.credentials.getClientCredentials();
    const redirectUri = `${deps.publicBaseUrl}/whoop/callback`;

    const tokenSet = await exchangeCodeForTokens(
      code,
      redirectUri,
      creds,
      payload.whoopCodeVerifier,
      fetchImpl,
    );

    const client = new WhoopClient(
      async () => tokenSet.accessToken,
      async () => {
        throw new Error("WHOOP authorization failed — please reconnect your WHOOP account.");
      },
      fetchImpl,
    );
    const profile = await client.getProfile();
    const whoopUserId = String(profile.user_id);
    const email = typeof profile.email === "string" ? profile.email : null;

    const userId = await deps.tokenStore.upsertUserAndTokens(whoopUserId, email, tokenSet);

    // Mint OUR authorization code, bound to the user + the client's PKCE challenge.
    const ourCode = randomBytes(32).toString("base64url");
    await deps.db.insert(schema.oauthAuthCodes).values({
      codeHash: sha256hex(ourCode),
      clientId: payload.clientId,
      userId,
      redirectUri: payload.clientRedirectUri,
      codeChallenge: payload.clientCodeChallenge,
      scopes: payload.scopes,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    });

    const redirect = new URL(payload.clientRedirectUri);
    redirect.searchParams.set("code", ourCode);
    if (payload.clientState !== undefined) redirect.searchParams.set("state", payload.clientState);
    res.redirect(302, redirect.toString());
  });

  return router;
}
