import { z } from "zod";

export interface AppConfig {
  databaseUrl: string; encryptionKey: string;
  whoopClientId: string; whoopClientSecret: string;
  publicBaseUrl: string; port: number;
  sessionSecret: string;
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
  const p = Schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL, encryptionKey: p.ENCRYPTION_KEY,
    whoopClientId: p.WHOOP_CLIENT_ID, whoopClientSecret: p.WHOOP_CLIENT_SECRET,
    publicBaseUrl: p.PUBLIC_BASE_URL, port: Number(p.PORT),
    sessionSecret: p.SESSION_SECRET,
  };
}
