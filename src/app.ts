import express from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AppConfig } from "./config.js";
import { getDb } from "./db/client.js";
import { TokenStore } from "./auth/token-store.js";
import { EnvCredentialProvider } from "./whoop/credentials.js";
import { refreshWhoopTokens } from "./whoop/oauth.js";
import { WhoopOAuthProvider } from "./auth/oauth-provider.js";
import { createWhoopCallbackRouter } from "./auth/whoop-callback.js";
import { createDashboardRouter } from "./dashboard/routes.js";
import { buildMcpServer } from "./mcp/server.js";

export function createApp(config: AppConfig): express.Express {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  const db = getDb(config.databaseUrl);
  const credentials = new EnvCredentialProvider(config.whoopClientId, config.whoopClientSecret);
  const creds = { clientId: config.whoopClientId, clientSecret: config.whoopClientSecret };
  const tokenStore = new TokenStore(db, config.encryptionKey, (rt) => refreshWhoopTokens(rt, creds));
  const provider = new WhoopOAuthProvider({ tokenStore, credentials, db, publicBaseUrl: config.publicBaseUrl });

  const issuerUrl = new URL(config.publicBaseUrl);
  app.use(mcpAuthRouter({ provider, issuerUrl, baseUrl: issuerUrl, scopesSupported: ["mcp"] }));
  app.use(createWhoopCallbackRouter({ db, tokenStore, credentials, publicBaseUrl: config.publicBaseUrl, restrictAccess: config.restrictAccess, allowedWhoopEmails: config.allowedWhoopEmails }));
  app.use("/dashboard", createDashboardRouter({ provider, tokenStore, sessionSecret: config.sessionSecret }));

  const auth = requireBearerAuth({ verifier: provider, requiredScopes: ["mcp"] });
  app.all("/mcp", auth, async (req, res) => {
    try {
      const mcpServer = buildMcpServer({ tokenStore, credentials });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  return app;
}
