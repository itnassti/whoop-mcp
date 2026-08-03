import { homedir } from "node:os";
import { join } from "node:path";

export function localConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "whoop-mcp");
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "whoop-mcp");
  return join(homedir(), ".config", "whoop-mcp");
}

export function tokenFilePath(dir: string): string {
  return join(dir, "tokens.enc");
}
