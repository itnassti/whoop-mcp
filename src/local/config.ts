import { localConfigDir } from "./paths.js";

export const DEFAULT_REDIRECT_URI = "https://caxtmann.github.io/whoop-mcp/callback/";

export interface LocalConfig {
  clientId: string; clientSecret: string; redirectUri: string; configDir: string;
}

export function loadLocalConfig(env: NodeJS.ProcessEnv): LocalConfig {
  const clientId = env.WHOOP_CLIENT_ID;
  const clientSecret = env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are required.");
  }
  return {
    clientId, clientSecret,
    redirectUri: env.WHOOP_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    configDir: localConfigDir(env),
  };
}
