import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildAuthorizeUrl, exchangeCodeForTokens } from "../whoop/oauth.js";
import type { LocalTokenStore } from "./token-store.js";

const b64url = (b: Buffer) => b.toString("base64url");
const pendingPath = (dir: string) => join(dir, "pending-login.json");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function startLogin(dir: string, opts: { clientId: string; redirectUri: string }): { authorizeUrl: string } {
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(16));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(pendingPath(dir), JSON.stringify({ verifier, state }), { mode: 0o600 });
  const authorizeUrl = buildAuthorizeUrl({
    clientId: opts.clientId, redirectUri: opts.redirectUri, state, codeChallenge: challenge,
  });
  return { authorizeUrl };
}

export async function completeLogin(dir: string, opts: {
  code: string; state: string;
  creds: { clientId: string; clientSecret: string };
  redirectUri: string; store: LocalTokenStore;
  exchange?: typeof exchangeCodeForTokens;
}): Promise<void> {
  const p = pendingPath(dir);
  if (!existsSync(p)) throw new Error("No pending login. Run whoop_login first.");
  const pending = JSON.parse(readFileSync(p, "utf8")) as { verifier: string; state: string };
  if (pending.state !== opts.state) throw new Error("Login state mismatch — start over with whoop_login.");
  const exchange = opts.exchange ?? exchangeCodeForTokens;
  const tokens = await exchange(opts.code, opts.redirectUri, opts.creds, pending.verifier);
  opts.store.save(tokens);
  rmSync(p, { force: true });
}
