import { randomBytes } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import cookieSession from "cookie-session";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { TokenStore } from "../auth/token-store.js";

export interface DashboardDeps {
  provider: OAuthServerProvider;
  tokenStore: TokenStore;
  sessionSecret: string;
}

// Distinguishes the dashboard's own "login via WHOOP" round-trip from real, dynamically
// registered MCP clients (whose client_id values are CSPRNG-random) — this id is never
// registered in oauthClients, so it can never collide with one.
const DASHBOARD_CLIENT_ID = "whoop-mcp-dashboard";

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function connectedRedirectUri(req: Request): string {
  return `${req.protocol}://${req.get("host")}${req.baseUrl}/connected`;
}

function dashboardClient(redirectUri: string): OAuthClientInformationFull {
  return { client_id: DASHBOARD_CLIENT_ID, redirect_uris: [redirectUri] } as OAuthClientInformationFull;
}

export function createDashboardRouter(deps: DashboardDeps): Router {
  const router = Router();
  router.use(
    cookieSession({
      name: "whoop_dashboard_session",
      secret: deps.sessionSecret,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    }),
  );
  router.use(express.urlencoded({ extended: false }));

  router.get("/", (req: Request, res: Response) => {
    const userId = req.session?.userId as string | undefined;
    if (!userId) {
      res.status(200).send(
        page(
          "WHOOP Dashboard",
          `<h1>WHOOP Dashboard</h1>
           <p>Connect your WHOOP account to get started.</p>
           <a href="${req.baseUrl}/connect"><button type="button">Connect WHOOP</button></a>`,
        ),
      );
      return;
    }
    res.status(200).send(
      page(
        "WHOOP Dashboard",
        `<h1>WHOOP Dashboard</h1>
         <p>Your WHOOP account is connected.</p>
         <form method="POST" action="${req.baseUrl}/pat">
           <button type="submit">Create personal access token</button>
         </form>
         <form method="POST" action="${req.baseUrl}/delete">
           <button type="submit">Delete my account</button>
         </form>`,
      ),
    );
  });

  // Starts the WHOOP OAuth flow for the dashboard by reusing the provider's own
  // authorize()/pending-authorization mechanism (Task 7), with a dashboard-specific
  // client id standing in for a real registered MCP client.
  router.get("/connect", async (req: Request, res: Response) => {
    try {
      const redirectUri = connectedRedirectUri(req);
      // CSRF/login-fixation guard: bind this login attempt to the initiating browser session.
      // The state travels through WHOOP and back to /connected, where it must match what we
      // stored here. An attacker's captured code carries a state the victim's session lacks.
      const oauthState = randomBytes(32).toString("base64url");
      if (req.session) req.session.oauthState = oauthState;
      await deps.provider.authorize(
        dashboardClient(redirectUri),
        { redirectUri, state: oauthState, codeChallenge: "unused" },
        res,
      );
    } catch {
      res.status(502).send("Could not start the WHOOP connection, please try again.");
    }
  });

  // Completion of the dashboard's own OAuth round-trip: /whoop/callback (Task 7) redirects
  // here with an authorization code once WHOOP + our token exchange succeed. We redeem it
  // through the same provider, then read the resulting token's userId to start a session.
  router.get("/connected", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    if (!code) {
      res.status(400).send("Missing authorization code.");
      return;
    }
    // CSRF/login-fixation guard: the returned state must match the one bound to this browser
    // session at /connect. Reject before touching the code so a forged callback can't set a session.
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const expectedState = req.session?.oauthState as string | undefined;
    if (!state || !expectedState || state !== expectedState) {
      if (req.session) req.session.oauthState = undefined;
      res.status(403).send("Invalid or missing state.");
      return;
    }
    if (req.session) req.session.oauthState = undefined; // one-time use
    try {
      const redirectUri = connectedRedirectUri(req);
      const tokens = await deps.provider.exchangeAuthorizationCode(dashboardClient(redirectUri), code);
      const authInfo = await deps.provider.verifyAccessToken(tokens.access_token);
      const userId = authInfo.extra?.userId;
      if (typeof userId !== "string" || !req.session) {
        res.status(502).send("WHOOP connection failed, please try again.");
        return;
      }
      req.session.userId = userId;
      res.redirect(302, req.baseUrl || "/");
    } catch {
      res.status(502).send("WHOOP connection failed, please try again.");
    }
  });

  router.post("/pat", async (req: Request, res: Response) => {
    const userId = req.session?.userId as string | undefined;
    if (!userId) {
      res.status(401).send("Not connected.");
      return;
    }
    const token = await deps.tokenStore.issueMcpToken(userId, "pat");
    res.status(200).send(
      page(
        "Personal access token",
        `<h1>Personal access token created</h1>
         <p>Copy this token now — it will not be shown again.</p>
         <code>${token}</code>
         <form method="POST" action="${req.baseUrl}/pat/revoke">
           <input type="hidden" name="token" value="${token}" />
           <button type="submit">Revoke this token</button>
         </form>
         <p><a href="${req.baseUrl}/">Back to dashboard</a></p>`,
      ),
    );
  });

  router.post("/pat/revoke", async (req: Request, res: Response) => {
    const userId = req.session?.userId as string | undefined;
    if (!userId) {
      res.status(401).send("Not connected.");
      return;
    }
    const token = typeof req.body?.token === "string" ? req.body.token : undefined;
    if (!token) {
      res.status(400).send("Missing token.");
      return;
    }
    await deps.tokenStore.revokeMcpToken(token);
    res.status(200).send(page("Token revoked", `<h1>Token revoked</h1><p><a href="${req.baseUrl}/">Back to dashboard</a></p>`));
  });

  router.post("/delete", async (req: Request, res: Response) => {
    const userId = req.session?.userId as string | undefined;
    if (!userId) {
      res.status(401).send("Not connected.");
      return;
    }
    await deps.tokenStore.deleteUser(userId);
    req.session = null;
    res.status(200).send(page("Account deleted", `<h1>Account deleted</h1><p>Your WHOOP connection and data have been removed.</p>`));
  });

  return router;
}
