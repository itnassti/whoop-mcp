import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerWhoopTools } from "../mcp/server.js";
import { WhoopClient } from "../whoop/client.js";
import { loadLocalConfig } from "./config.js";
import { LocalTokenStore } from "./token-store.js";
import { startLogin, completeLogin } from "./login.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

async function main() {
  const cfg = loadLocalConfig(process.env);
  const creds = { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
  const store = new LocalTokenStore(cfg.configDir, creds);
  const client = new WhoopClient(
    () => store.getValidAccessToken(),
    () => store.forceRefreshAccessToken(),
  );

  const server = new McpServer({ name: "whoop-mcp-local", version: "0.1.0" });
  registerWhoopTools(server, () => client, () => "local");

  server.registerTool(
    "whoop_login",
    { description: "Start connecting your WHOOP account. Returns a URL to open; after approving, copy the code shown on the callback page and call whoop_complete_login.", inputSchema: {} },
    async () => {
      const { authorizeUrl } = startLogin(cfg.configDir, { clientId: cfg.clientId, redirectUri: cfg.redirectUri });
      return textResult(`Open this URL in your browser and approve access:\n\n${authorizeUrl}\n\nThen copy the "code" and "state" values shown on the page and call whoop_complete_login with them.`);
    },
  );

  server.registerTool(
    "whoop_complete_login",
    { description: "Finish connecting WHOOP: paste the code and state from the callback page.",
      inputSchema: { code: z.string().min(1), state: z.string().min(1) } },
    async (args: any) => {
      try {
        await completeLogin(cfg.configDir, {
          code: args.code, state: args.state, creds, redirectUri: cfg.redirectUri, store,
        });
        return textResult("WHOOP connected. You can now use the data tools.");
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Login failed: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  await server.connect(new StdioServerTransport());
}

main().catch((e) => { console.error(e); process.exit(1); });
