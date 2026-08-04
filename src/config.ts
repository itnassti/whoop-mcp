import { z } from "zod";

export interface AppConfig {
  databaseUrl: string; encryptionKey: string;
  whoopClientId: string; whoopClientSecret: string;
  publicBaseUrl: string; port: number;
  sessionSecret: string;
  // Optional allowlist of WHOOP account emails permitted to connect. Empty = open to anyone.
  allowedWhoopEmails: string[];
}

const Schema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 32-byte hex"),
  WHOOP_CLIENT_ID: z.string().min(1),
  WHOOP_CLIENT_SECRET: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).default("8080"),
  SESSION_SECRET: z.string().min(16),
});

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  // `||` (not `??`) so an empty-string PUBLIC_BASE_URL is treated as unset and
  // still falls back to RAILWAY_PUBLIC_DOMAIN — otherwise a blank env var would
  // skip the fallback and fail URL validation, crashing startup.
  const publicBaseUrl =
    env.PUBLIC_BASE_URL ||
    (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  const p = Schema.parse({ ...env, PUBLIC_BASE_URL: publicBaseUrl });
  const allowedWhoopEmails = (env.ALLOWED_WHOOP_EMAILS ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    databaseUrl: p.DATABASE_URL, encryptionKey: p.ENCRYPTION_KEY,
    whoopClientId: p.WHOOP_CLIENT_ID, whoopClientSecret: p.WHOOP_CLIENT_SECRET,
    publicBaseUrl: p.PUBLIC_BASE_URL, port: Number(p.PORT),
    sessionSecret: p.SESSION_SECRET, allowedWhoopEmails,
  };
}
