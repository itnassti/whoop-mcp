# Distribution Weg B — Lokale Claude-Desktop-Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine kostenlose, lokale Claude-Desktop-Extension (`.mcpb`) bereitstellen, die den WHOOP-MCP als stdio-Server für einen einzelnen Nutzer betreibt — ohne Server, Postgres oder OAuth-Authorization-Server.

**Architecture:** Ein leichter zweiter Einstiegspunkt neben dem bestehenden HTTP-Server, beide über einen geteilten Kern. Der Kern (`WhoopClient`, die 7 Tools, WHOOP-OAuth-Helfer, `crypto`) bleibt unverändert; ein kleiner verhaltenserhaltender Refactor zieht die Tool-Registrierung aus dem HTTP-`buildMcpServer` heraus, damit der stdio-Server sie mitbenutzt. Single-User-Tokens liegen verschlüsselt lokal; der WHOOP-Login läuft über zwei MCP-Tools + eine statische https-Callback-Seite (WHOOP verbietet `http://localhost`-Redirects).

**Tech Stack:** Node ≥22, TypeScript, `@modelcontextprotocol/sdk` (StdioServerTransport), Vitest, `@anthropic-ai/mcpb` (Bundle-CLI), GitHub Pages (statische Callback-Seite).

## Global Constraints

- **Node ≥22** (`engines.node` bleibt); Web-Crypto/`node:crypto` zur Laufzeit nötig.
- **Keine Postgres-/Express-/OAuth-Server-Abhängigkeit** im stdio-Pfad. Der stdio-Entrypoint darf `src/db/*`, `src/app.ts`, `src/auth/oauth-provider.ts` NICHT importieren.
- **WHOOP-Redirect-URI:** nur `https://…` (kein `http://localhost`). Weg B nutzt eine statische https-Seite als Redirect-Ziel; ihr URL ist der registrierte Redirect-URI.
- **WHOOP-Scopes (verbatim):** `read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement offline` — bereits als `WHOOP_SCOPES` in [src/whoop/oauth.ts](../../../src/whoop/oauth.ts).
- **Bestehender HTTP-Server darf nicht brechen:** der Refactor (Task 1) ist rein verhaltenserhaltend; `npm test` muss vor und nach jedem Task grün sein.
- **Token-Datei-Verschlüsselung:** bestehendes AES-256-GCM aus [src/crypto.ts](../../../src/crypto.ts); Schlüssel wird deterministisch aus dem `client_secret` abgeleitet (das via mcpb-`sensitive`-Config im OS-Keychain liegt). Kein Native-Keychain-Modul.
- **Dateirechte:** alle lokal geschriebenen Dateien (Tokens, Pending-Login) mit Modus `0600`.
- **Existierende Exporte nicht umbenennen** ohne Not (`WhoopClient`, `makeToolHandlers`, `RANGE_SCHEMA`, `buildAuthorizeUrl`, `exchangeCodeForTokens`, `refreshWhoopTokens`, `WHOOP_SCOPES`, `encrypt`, `decrypt`).

---

### Task 1: Shared-Core-Refactor — Tool-Registrierung aus `buildMcpServer` extrahieren

**Files:**
- Modify: `src/mcp/server.ts` (extrahiere `registerWhoopTools`, `buildMcpServer` ruft es auf)
- Test: `test/mcp-server.test.ts` (neu)

**Interfaces:**
- Consumes: `makeToolHandlers`, `RANGE_SCHEMA` (unverändert aus [src/mcp/tools.ts](../../../src/mcp/tools.ts)); `WhoopClient`.
- Produces: `export function registerWhoopTools(server: McpServer, clientFor: (userId: string) => WhoopClient, userIdOf: (extra: any) => string): void`. `buildMcpServer(deps)` bleibt in Signatur/Verhalten identisch und delegiert an `registerWhoopTools`. Der stdio-Server (Task 4) ruft `registerWhoopTools` mit `clientFor = () => localClient` und `userIdOf = () => "local"`.

- [ ] **Step 1: Failing test schreiben**

Neu `test/mcp-server.test.ts` — prüft, dass `registerWhoopTools` die 7 Tools registriert und ein Tool über einen injizierten Fake-Client Daten liefert:

```ts
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWhoopTools } from "../src/mcp/server.js";
import { WhoopClient } from "../src/whoop/client.js";

function fakeClient(): WhoopClient {
  // fetchImpl returns a fixed profile; token getters are no-ops.
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ user_id: 42, email: "a@b.c" }), { status: 200 })) as any;
  return new WhoopClient(async () => "tok", async () => "tok", fetchImpl);
}

describe("registerWhoopTools", () => {
  it("registers the 7 WHOOP tools on the server", () => {
    const server = new McpServer({ name: "t", version: "0" });
    registerWhoopTools(server, () => fakeClient(), () => "local");
    // McpServer keeps registered tools; assert the known names are present.
    const names = Object.keys((server as any)._registeredTools ?? {});
    for (const n of ["get_recovery","get_sleep","get_workouts","get_cycles","get_profile","get_body_measurement","get_daily_summary"]) {
      expect(names).toContain(n);
    }
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run test/mcp-server.test.ts`
Expected: FAIL — `registerWhoopTools` ist noch nicht exportiert.

- [ ] **Step 3: Refactor umsetzen**

In [src/mcp/server.ts](../../../src/mcp/server.ts): die Registrier-Logik in eine exportierte Funktion ziehen; `buildMcpServer` ruft sie mit dem bestehenden Verhalten auf:

```ts
export function registerWhoopTools(
  server: McpServer,
  clientFor: (userId: string) => WhoopClient,
  userIdOf: (extra: any) => string,
): void {
  const h = makeToolHandlers(clientFor);
  const reg = (name: string, description: string, shape: any, fn: any) =>
    server.registerTool(name, { description, inputSchema: shape },
      async (args: any, extra: any) => fn(args, { userId: userIdOf(extra) }));

  reg("get_recovery", "Get WHOOP recovery records (score, HRV, RHR, SpO2, skin temp).", RANGE_SCHEMA, h.get_recovery);
  reg("get_sleep", "Get WHOOP sleep records (stages, performance, respiratory rate).", RANGE_SCHEMA, h.get_sleep);
  reg("get_workouts", "Get WHOOP workouts (strain, HR zones, distance).", RANGE_SCHEMA, h.get_workouts);
  reg("get_cycles", "Get WHOOP physiological cycles (daily strain, energy).", RANGE_SCHEMA, h.get_cycles);
  reg("get_profile", "Get the user's WHOOP profile (name, email).", {}, h.get_profile);
  reg("get_body_measurement", "Get body measurements (height, weight, max HR).", {}, h.get_body_measurement);
  reg("get_daily_summary", "Get combined recovery + sleep + strain for a single date (YYYY-MM-DD).",
    { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD") }, h.get_daily_summary);
}

export function buildMcpServer(deps: { tokenStore: TokenStore; credentials: CredentialProvider }): McpServer {
  const server = new McpServer({ name: "whoop-mcp", version: "0.1.0" });
  const clientFor = (userId: string) =>
    new WhoopClient(
      () => deps.tokenStore.getValidAccessToken(userId),
      async () => deps.tokenStore.forceRefreshAccessToken(userId),
    );
  registerWhoopTools(server, clientFor, (extra: any) => extra?.authInfo?.extra?.userId);
  return server;
}
```

- [ ] **Step 4: Tests grün**

Run: `npx vitest run test/mcp-server.test.ts test/tools.test.ts`
Expected: PASS. Falls `_registeredTools` in Step 1 nicht existiert (SDK-Interna), passe die Assertion an das an, was `McpServer` tatsächlich exponiert (z.B. über `server.server` oder einen `ListTools`-Roundtrip) — die Absicht ist „die 7 Tools sind registriert".

- [ ] **Step 5: Volle Suite absichern**

Run: `env -u DATABASE_URL npm test`
Expected: PASS (HTTP-Server-Verhalten unverändert).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts test/mcp-server.test.ts
git commit -m "refactor(mcp): extract registerWhoopTools for reuse by stdio entrypoint"
```

---

### Task 2: Lokale Pfade + `LocalTokenStore` (verschlüsselter Single-User-Token)

**Files:**
- Create: `src/local/paths.ts`
- Create: `src/local/token-store.ts`
- Test: `test/local-token-store.test.ts`

**Interfaces:**
- Consumes: `encrypt`, `decrypt` ([src/crypto.ts](../../../src/crypto.ts)); `refreshWhoopTokens` ([src/whoop/oauth.ts](../../../src/whoop/oauth.ts)); `WhoopTokenSet` ([src/whoop/types.ts](../../../src/whoop/types.ts)).
- Produces:
  - `paths.ts`: `export function localConfigDir(env?: NodeJS.ProcessEnv): string` (OS-spezifisch), `export function tokenFilePath(dir: string): string`.
  - `token-store.ts`: `export function deriveKeyHex(clientSecret: string): string`; `export class LocalTokenStore` with `constructor(dir: string, creds: { clientId: string; clientSecret: string }, refreshFn?: (rt: string, creds: {clientId:string;clientSecret:string}) => Promise<WhoopTokenSet>)`, and methods `save(t: WhoopTokenSet): void`, `load(): WhoopTokenSet | null`, `getValidAccessToken(): Promise<string>`, `forceRefreshAccessToken(): Promise<string>`. Task 4's `clientFor` wraps this into a `WhoopClient`.

- [ ] **Step 1: Failing tests schreiben**

`test/local-token-store.test.ts` — nutzt ein temporäres Verzeichnis:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalTokenStore, deriveKeyHex } from "../src/local/token-store.js";
import { localConfigDir } from "../src/local/paths.js";

const creds = { clientId: "id", clientSecret: "sekret" };
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "whoop-local-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const tokenSet = (overrides = {}) => ({
  accessToken: "AT", refreshToken: "RT",
  expiresAt: new Date(Date.now() + 3600_000), scopes: ["offline"], ...overrides,
});

describe("deriveKeyHex", () => {
  it("produces a 32-byte hex key deterministically from the client secret", () => {
    const k = deriveKeyHex("sekret");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveKeyHex("sekret")).toBe(k);
    expect(deriveKeyHex("other")).not.toBe(k);
  });
});

describe("localConfigDir", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    expect(localConfigDir({ XDG_CONFIG_HOME: "/x" } as any)).toBe("/x/whoop-mcp");
  });
});

describe("LocalTokenStore", () => {
  it("save() then load() round-trips the token set and writes a 0600 file", () => {
    const s = new LocalTokenStore(dir, creds);
    const t = tokenSet();
    s.save(t);
    const loaded = s.load()!;
    expect(loaded.accessToken).toBe("AT");
    expect(loaded.refreshToken).toBe("RT");
    expect(new Date(loaded.expiresAt).getTime()).toBe(t.expiresAt.getTime());
    const mode = statSync(join(dir, "tokens.enc")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("load() returns null when no token file exists", () => {
    expect(new LocalTokenStore(dir, creds).load()).toBeNull();
  });

  it("getValidAccessToken() returns the stored token when not expired", async () => {
    const s = new LocalTokenStore(dir, creds);
    s.save(tokenSet());
    expect(await s.getValidAccessToken()).toBe("AT");
  });

  it("getValidAccessToken() refreshes + persists when expired", async () => {
    const refreshed = tokenSet({ accessToken: "AT2", refreshToken: "RT2" });
    const refreshFn = async (rt: string) => { expect(rt).toBe("RT"); return refreshed; };
    const s = new LocalTokenStore(dir, creds, refreshFn as any);
    s.save(tokenSet({ expiresAt: new Date(Date.now() - 1000) }));
    expect(await s.getValidAccessToken()).toBe("AT2");
    expect(s.load()!.refreshToken).toBe("RT2"); // persisted
  });

  it("getValidAccessToken() throws a clear error when not connected", async () => {
    await expect(new LocalTokenStore(dir, creds).getValidAccessToken())
      .rejects.toThrow(/whoop_login/i);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run test/local-token-store.test.ts`
Expected: FAIL — Module existieren noch nicht.

- [ ] **Step 3: `paths.ts` implementieren**

```ts
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
```

- [ ] **Step 4: `token-store.ts` implementieren**

```ts
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { encrypt, decrypt } from "../crypto.js";
import { refreshWhoopTokens } from "../whoop/oauth.js";
import type { WhoopTokenSet } from "../whoop/types.js";
import { tokenFilePath } from "./paths.js";

type Creds = { clientId: string; clientSecret: string };
type RefreshFn = (refreshToken: string, creds: Creds) => Promise<WhoopTokenSet>;
const EXPIRY_SKEW_MS = 60_000;

export function deriveKeyHex(clientSecret: string): string {
  return createHash("sha256").update("whoop-mcp-token-key:" + clientSecret).digest("hex");
}

export class LocalTokenStore {
  private keyHex: string;
  constructor(private dir: string, private creds: Creds, private refreshFn: RefreshFn = refreshWhoopTokens) {
    this.keyHex = deriveKeyHex(creds.clientSecret);
  }

  save(t: WhoopTokenSet): void {
    mkdirSync(this.dir, { recursive: true });
    const plain = JSON.stringify({ ...t, expiresAt: t.expiresAt.toISOString() });
    writeFileSync(tokenFilePath(this.dir), encrypt(plain, this.keyHex), { mode: 0o600 });
  }

  load(): WhoopTokenSet | null {
    const p = tokenFilePath(this.dir);
    if (!existsSync(p)) return null;
    const o = JSON.parse(decrypt(readFileSync(p, "utf8"), this.keyHex));
    return { ...o, expiresAt: new Date(o.expiresAt) };
  }

  async getValidAccessToken(): Promise<string> {
    const t = this.load();
    if (!t) throw new Error("WHOOP not connected. Run the whoop_login tool first.");
    if (t.expiresAt.getTime() - Date.now() > EXPIRY_SKEW_MS) return t.accessToken;
    return this.refreshAndStore(t.refreshToken);
  }

  async forceRefreshAccessToken(): Promise<string> {
    const t = this.load();
    if (!t) throw new Error("WHOOP not connected. Run the whoop_login tool first.");
    return this.refreshAndStore(t.refreshToken);
  }

  private async refreshAndStore(refreshToken: string): Promise<string> {
    const refreshed = await this.refreshFn(refreshToken, this.creds);
    this.save(refreshed);
    return refreshed.accessToken;
  }
}
```

- [ ] **Step 5: Tests grün + volle Suite**

Run: `npx vitest run test/local-token-store.test.ts && env -u DATABASE_URL npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/local/paths.ts src/local/token-store.ts test/local-token-store.test.ts
git commit -m "feat(local): single-user encrypted LocalTokenStore + config paths"
```

---

### Task 3: Login-Kern — PKCE + Pending-Login-Store + Exchange-Orchestrierung

**Files:**
- Create: `src/local/login.ts`
- Test: `test/local-login.test.ts`

**Interfaces:**
- Consumes: `buildAuthorizeUrl`, `exchangeCodeForTokens` ([src/whoop/oauth.js](../../../src/whoop/oauth.js)); `LocalTokenStore` (Task 2); `localConfigDir`.
- Produces (pure, testbar):
  - `export function pkcePair(): { verifier: string; challenge: string }`
  - `export function startLogin(dir: string, opts: { clientId: string; redirectUri: string }): { authorizeUrl: string }` — erzeugt PKCE+state, schreibt `pending-login.json` (0600), gibt die Authorize-URL zurück.
  - `export async function completeLogin(dir: string, opts: { code: string; state: string; creds: { clientId: string; clientSecret: string }; redirectUri: string; store: LocalTokenStore; exchange?: typeof exchangeCodeForTokens }): Promise<void>` — liest Pending, prüft state, tauscht Code→Tokens, speichert via `store`, löscht Pending.

- [ ] **Step 1: Failing tests schreiben**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pkcePair, startLogin, completeLogin } from "../src/local/login.js";
import { LocalTokenStore } from "../src/local/token-store.js";

const creds = { clientId: "id", clientSecret: "sekret" };
const redirectUri = "https://example.github.io/whoop-mcp/callback/";
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "whoop-login-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("pkcePair", () => {
  it("returns a URL-safe verifier and a base64url S256 challenge", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });
});

describe("startLogin + completeLogin", () => {
  it("startLogin returns an authorize URL carrying client_id, redirect_uri, S256 and state", () => {
    const { authorizeUrl } = startLogin(dir, { clientId: "id", redirectUri });
    const u = new URL(authorizeUrl);
    expect(u.searchParams.get("client_id")).toBe("id");
    expect(u.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBeTruthy();
  });

  it("completeLogin rejects a mismatched state", async () => {
    startLogin(dir, { clientId: "id", redirectUri });
    const store = new LocalTokenStore(dir, creds);
    await expect(completeLogin(dir, { code: "c", state: "WRONG", creds, redirectUri, store }))
      .rejects.toThrow(/state/i);
  });

  it("completeLogin exchanges the code and saves tokens", async () => {
    const { authorizeUrl } = startLogin(dir, { clientId: "id", redirectUri });
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    const exchange = (async (code: string, ru: string, c: any, verifier: string) => {
      expect(code).toBe("the-code"); expect(ru).toBe(redirectUri);
      expect(c.clientSecret).toBe("sekret"); expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      return { accessToken: "AT", refreshToken: "RT", expiresAt: new Date(Date.now()+3600_000), scopes: ["offline"] };
    }) as any;
    const store = new LocalTokenStore(dir, creds);
    await completeLogin(dir, { code: "the-code", state, creds, redirectUri, store, exchange });
    expect(store.load()!.accessToken).toBe("AT");
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run test/local-login.test.ts`
Expected: FAIL — `src/local/login.ts` fehlt.

- [ ] **Step 3: `login.ts` implementieren**

```ts
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
  mkdirSync(dir, { recursive: true });
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
```

- [ ] **Step 4: Tests grün + volle Suite**

Run: `npx vitest run test/local-login.test.ts && env -u DATABASE_URL npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/local/login.ts test/local-login.test.ts
git commit -m "feat(local): PKCE login core with pending-state store and code exchange"
```

---

### Task 4: stdio-Entrypoint + Login-MCP-Tools

**Files:**
- Create: `src/local/config.ts` (liest die stdio-Env)
- Create: `src/local/index.ts` (stdio-Entrypoint)
- Modify: `package.json` (bin-Eintrag + `start:local`-Script)
- Test: `test/local-config.test.ts`

**Interfaces:**
- Consumes: `registerWhoopTools` (Task 1); `LocalTokenStore` (Task 2); `startLogin`, `completeLogin` (Task 3); `WhoopClient`; `StdioServerTransport` (`@modelcontextprotocol/sdk/server/stdio.js`); `McpServer`.
- Produces:
  - `config.ts`: `export interface LocalConfig { clientId: string; clientSecret: string; redirectUri: string; configDir: string }` und `export function loadLocalConfig(env: NodeJS.ProcessEnv): LocalConfig` (validiert Pflicht-Env, leitet `configDir` aus `localConfigDir` ab, `redirectUri` aus `WHOOP_REDIRECT_URI` mit dem publizierten GitHub-Pages-Default).
  - `index.ts`: baut `McpServer`, registriert die 7 Tools (`registerWhoopTools`) + `whoop_login`/`whoop_complete_login`, verbindet stdio. Kein Test-Export nötig (dünne Verdrahtung).

- [ ] **Step 1: Failing test für `loadLocalConfig`**

```ts
import { describe, it, expect } from "vitest";
import { loadLocalConfig } from "../src/local/config.js";

const base = { WHOOP_CLIENT_ID: "id", WHOOP_CLIENT_SECRET: "secret", XDG_CONFIG_HOME: "/cfg" };

describe("loadLocalConfig", () => {
  it("reads creds and derives configDir + default redirectUri", () => {
    const c = loadLocalConfig(base as any);
    expect(c.clientId).toBe("id");
    expect(c.clientSecret).toBe("secret");
    expect(c.configDir).toBe("/cfg/whoop-mcp");
    expect(c.redirectUri).toMatch(/^https:\/\/.+\/callback\/?$/);
  });
  it("honours an explicit WHOOP_REDIRECT_URI", () => {
    const c = loadLocalConfig({ ...base, WHOOP_REDIRECT_URI: "https://x.y/cb/" } as any);
    expect(c.redirectUri).toBe("https://x.y/cb/");
  });
  it("throws when a required credential is missing", () => {
    expect(() => loadLocalConfig({ XDG_CONFIG_HOME: "/cfg" } as any)).toThrow();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run test/local-config.test.ts`
Expected: FAIL — `src/local/config.ts` fehlt.

- [ ] **Step 3: `config.ts` implementieren**

`DEFAULT_REDIRECT_URI` ist der publizierte statische Callback (Task 5) — Repo ist `github.com/caxtmann/whoop-mcp`, also die konkrete Pages-URL:

```ts
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
```

- [ ] **Step 4: Tests grün**

Run: `npx vitest run test/local-config.test.ts`
Expected: PASS.

- [ ] **Step 5: `index.ts` (stdio-Entrypoint) schreiben**

```ts
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
```

- [ ] **Step 6: `package.json` — bin + Script**

Ergänze (bestehende Felder unberührt):

```json
  "bin": { "whoop-mcp-local": "dist/local/index.js" },
  "scripts": {
    "start:local": "node dist/local/index.js"
  }
```

(In den bestehenden `scripts`-Block einfügen, nicht ersetzen.)

- [ ] **Step 7: Build + manueller stdio-Rauchtest**

Run: `npm run build`
Expected: kompiliert ohne Fehler; `dist/local/index.js` existiert.

Manueller Rauchtest (ohne echten Login — erwartet die "not connected"-Antwort):
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | WHOOP_CLIENT_ID=x WHOOP_CLIENT_SECRET=y node dist/local/index.js
```
Expected: eine `tools/list`-Antwort, die die 7 Daten-Tools **und** `whoop_login` + `whoop_complete_login` enthält.

- [ ] **Step 8: Volle Suite + Commit**

Run: `env -u DATABASE_URL npm test`
Expected: PASS.

```bash
git add src/local/config.ts src/local/index.ts test/local-config.test.ts package.json
git commit -m "feat(local): stdio entrypoint with WHOOP data tools + login tools"
```

---

### Task 5: Statische https-Callback-Seite (GitHub Pages)

Enthält einen **manuellen** GitHub-Pages-Publish-Schritt. Die Seite hält keinen Secret; sie zeigt nur `code`/`state` zum Kopieren. Repo: `github.com/caxtmann/whoop-mcp` → Ziel-URL `https://caxtmann.github.io/whoop-mcp/callback/`. Damit die URL genau `…/whoop-mcp/callback/` lautet, liegt die Seite unter `callback/` im **Repo-Root** und Pages wird aus `main`/root serviert. `.nojekyll` verhindert Jekyll-Verarbeitung.

**Files:**
- Create: `callback/index.html`
- Create: `.nojekyll` (leer)

**Interfaces:**
- Consumes: nichts.
- Produces: die öffentliche URL `https://caxtmann.github.io/whoop-mcp/callback/`, die bereits in `DEFAULT_REDIRECT_URI` (Task 4) steht und in der Weg-B-Doku (Task 6) genutzt wird; jeder Self-Hoster registriert sie als WHOOP-Redirect-URI.

- [ ] **Step 1: Seite + `.nojekyll` schreiben**

`callback/index.html` — liest Query-Parameter und zeigt sie an; reines HTML/JS, keine externen Ressourcen. Zusätzlich eine leere Datei `.nojekyll` im Repo-Root anlegen.

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>WHOOP MCP — connect</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem}
code{background:#f2f2f2;padding:.15rem .35rem;border-radius:.25rem}
.box{background:#f7f7f7;border:1px solid #ddd;border-radius:.5rem;padding:1rem;margin:1rem 0;word-break:break-all}
button{padding:.4rem .8rem}</style></head>
<body>
<h1>WHOOP connected — almost done</h1>
<p>Copy these two values back into your AI assistant's <code>whoop_complete_login</code> tool:</p>
<div class="box"><strong>code</strong><br><span id="code"></span> <button onclick="copy('code')">Copy</button></div>
<div class="box"><strong>state</strong><br><span id="state"></span> <button onclick="copy('state')">Copy</button></div>
<p id="err" style="color:#b00"></p>
<script>
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state"), error = q.get("error");
  if (error) { document.getElementById("err").textContent = "WHOOP returned an error: " + error; }
  document.getElementById("code").textContent = code || "(missing)";
  document.getElementById("state").textContent = state || "(missing)";
  function copy(id){ navigator.clipboard.writeText(document.getElementById(id).textContent); }
</script>
</body></html>
```

- [ ] **Step 2: Commit**

```bash
git add callback/index.html .nojekyll
git commit -m "feat(local): static GitHub Pages callback page for local WHOOP login"
```

- [ ] **Step 3: GitHub Pages veröffentlichen (MANUELL, Nutzer)**

Repo-Settings → Pages → Source: „Deploy from a branch" → Branch `main`, Ordner `/ (root)` → Save. Nach dem Build ist die Seite unter `https://caxtmann.github.io/whoop-mcp/callback/` erreichbar.
Verifikation: die URL im Browser mit `?code=abc&state=xyz` öffnen → zeigt `abc` und `xyz` an. (Da `DEFAULT_REDIRECT_URI` bereits diese URL ist, ist kein weiterer Code-Swap nötig.)

---

### Task 6: `.mcpb`-Manifest + Bundle-Build

Enthält einen **manuellen** Verifikationsschritt (Installation in Claude Desktop).

**Files:**
- Create: `mcpb/manifest.json`
- Modify: `package.json` (devDependency `@anthropic-ai/mcpb` + `bundle:local`-Script)

**Interfaces:**
- Consumes: der gebaute stdio-Entrypoint `dist/local/index.js` (Task 4).
- Produces: eine installierbare `whoop-mcp.mcpb`-Datei; ihr `user_config` sammelt `whoop_client_id`, `whoop_client_secret` (sensitive → OS-Keychain), optional `whoop_redirect_uri`, und reicht sie als Env-Vars an den stdio-Server.

- [ ] **Step 1: `manifest.json` schreiben**

Nach dem `.mcpb`-Manifest-Schema; `user_config`-Werte werden als Env-Vars in den Server injiziert (`${user_config.…}`):

```json
{
  "manifest_version": "0.1",
  "name": "whoop-mcp-local",
  "display_name": "WHOOP (local)",
  "version": "0.1.0",
  "description": "Access your own WHOOP data (recovery, sleep, workouts, cycles, profile) locally in Claude Desktop.",
  "author": { "name": "Christian Axtmann" },
  "license": "MIT",
  "server": {
    "type": "node",
    "entry_point": "dist/local/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/local/index.js"],
      "env": {
        "WHOOP_CLIENT_ID": "${user_config.whoop_client_id}",
        "WHOOP_CLIENT_SECRET": "${user_config.whoop_client_secret}",
        "WHOOP_REDIRECT_URI": "${user_config.whoop_redirect_uri}"
      }
    }
  },
  "user_config": {
    "whoop_client_id": { "type": "string", "title": "WHOOP Client ID", "required": true },
    "whoop_client_secret": { "type": "string", "title": "WHOOP Client Secret", "sensitive": true, "required": true },
    "whoop_redirect_uri": { "type": "string", "title": "Redirect URI (leave blank to use the default callback page)", "required": false }
  },
  "tools": [
    { "name": "whoop_login" }, { "name": "whoop_complete_login" },
    { "name": "get_recovery" }, { "name": "get_sleep" }, { "name": "get_workouts" },
    { "name": "get_cycles" }, { "name": "get_profile" }, { "name": "get_body_measurement" },
    { "name": "get_daily_summary" }
  ]
}
```

Hinweis für den Implementierer: Prüfe die exakten Feldnamen des aktuellen `.mcpb`-Manifest-Schemas mit `npx @anthropic-ai/mcpb@latest init` in einem temporären Ordner und gleiche `server`/`user_config`/`env`-Struktur ab; korrigiere Abweichungen, ohne die Bedeutung zu ändern (Client-ID/Secret als user_config, Secret `sensitive`, Werte als Env-Vars an den Node-Server). Halte die Tool-Namen identisch zu Task 4.

- [ ] **Step 2: devDependency + Script ergänzen**

```bash
npm install --save-dev @anthropic-ai/mcpb
```
In `package.json` `scripts` ergänzen (bestehende unberührt):
```json
  "bundle:local": "npm run build && mcpb pack . whoop-mcp.mcpb"
```
(Falls `mcpb pack` andere Argumente erwartet, an die Ausgabe von `npx @anthropic-ai/mcpb pack --help` anpassen; Ziel: `whoop-mcp.mcpb` enthält `dist/`, `node_modules` der Laufzeit-Deps und `manifest.json`.)

- [ ] **Step 3: `.dockerignore`/`.gitignore` — Bundle-Artefakt ignorieren**

`whoop-mcp.mcpb` zu `.gitignore` hinzufügen (Build-Artefakt, nicht einchecken).

- [ ] **Step 4: Bundle bauen (Verifikation)**

Run: `npm run bundle:local`
Expected: erzeugt `whoop-mcp.mcpb` ohne Fehler; die Datei ist ein ZIP, das `manifest.json` + `dist/local/index.js` enthält (`unzip -l whoop-mcp.mcpb` prüfen).

- [ ] **Step 5: Manuelle End-to-End-Verifikation (Nutzer, Claude Desktop)**

`whoop-mcp.mcpb` per Doppelklick in Claude Desktop installieren → im Dialog WHOOP-Client-ID/Secret eintragen → `whoop_login` aufrufen → URL öffnen, WHOOP genehmigen → `code`/`state` von der Callback-Seite kopieren → `whoop_complete_login` → ein Daten-Tool (`get_profile`) liefert echte Daten. (Voraussetzung: die WHOOP-App des Nutzers hat die Callback-Seiten-URL als Redirect-URI registriert.)

- [ ] **Step 6: Commit**

```bash
git add mcpb/manifest.json package.json package-lock.json .gitignore
git commit -m "build(local): .mcpb manifest and bundle build for Claude Desktop"
```

---

### Task 7: Weg-B-Dokumentation im README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: die publizierte Callback-URL (Task 5), das `.mcpb`-Bundle (Task 6).
- Produces: der bislang als „kommt separat" markierte Weg-B-Abschnitt wird ausgefüllt.

- [ ] **Step 1: Weg-B-Abschnitt schreiben**

Im bestehenden „Zwei Wege"-Teil des README den Weg-B-Verweis durch einen echten Abschnitt ersetzen: (1) `.mcpb` herunterladen/installieren (Doppelklick); (2) **eigene WHOOP-App anlegen** mit Redirect-URI = der publizierten Callback-Seiten-URL (Task 5) und den Scopes aus den Global Constraints; (3) im Installationsdialog Client-ID/Secret eintragen; (4) Login-Flow: `whoop_login` → URL öffnen → genehmigen → `code`/`state` kopieren → `whoop_complete_login`; (5) Datentools nutzen. Kurzer Hinweis: kostenlos, nur Claude Desktop, Tokens liegen lokal verschlüsselt unter dem Config-Verzeichnis.

- [ ] **Step 2: Konsistenz-Gegenlesen**

Scopes exakt wie in den Global Constraints; Redirect-URI = Callback-Seiten-URL (nicht `/whoop/callback` — das ist der HTTP-Server-Pfad von Weg A); keine „TODO"-Reste.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Weg B — local Claude Desktop extension setup"
```

---

## Self-Review (gegen das Spec)

**Spec-Coverage (§2 Refactor + §4 Weg B):**
- §2 Shared-Core-Refactor (`WhoopClient`+Tools) → Task 1 (`registerWhoopTools`). ✅
- §4.1 stdio-Entrypoint (kein Express/OAuth/Postgres) → Task 4; Global Constraint verbietet die Imports. ✅
- §4.1 Single-User-Token-Store, verschlüsselt via `crypto.ts`, Schlüssel via keychain-gestütztem Secret → Task 2 (`deriveKeyHex` aus `client_secret`, das mcpb im Keychain hält). ✅ (Realisiert die Keychain-Absicht ohne Native-Modul; im Spec als „ENCRYPTION_KEY im Keychain" beschrieben — hier äquivalent über das keychain-gehaltene `client_secret` abgeleitet.)
- §4.1 `.mcpb`-Bundle mit `user_config` (Secret `sensitive` → Keychain) → Task 6. ✅
- §4.2 Login via statische https-Seite + Paste, als zwei MCP-Tools `whoop_login`/`whoop_complete_login` → Tasks 3 (Kern) + 4 (Tools) + 5 (Seite). ✅
- §5 Client-Einbindung (Claude Desktop, Weg B) → Task 7. ✅

**Placeholder-Scan:** Keine offenen Platzhalter mehr — Owner/Repo (`caxtmann/whoop-mcp`) und die konkrete Callback-URL stehen fest in `DEFAULT_REDIRECT_URI` (Task 4) und Task 5. Der einzige „manuelle" Rest ist das Aktivieren von GitHub Pages (Task 5 Step 3) und die Claude-Desktop-E2E-Installation (Task 6 Step 5) — Umgebungs-/Nutzer-Schritte, kein Code-Platzhalter.

**Typ-Konsistenz:** `registerWhoopTools(server, clientFor, userIdOf)` — identisch in Task 1 (Definition) und Task 4 (Aufruf). `LocalTokenStore`-Konstruktor + Methoden — identisch in Task 2 (Definition), Task 3 (Nutzung als `store`) und Task 4 (Instanzierung). `startLogin`/`completeLogin`-Signaturen — identisch in Task 3 (Definition) und Task 4 (Aufruf). `loadLocalConfig`/`LocalConfig` — Task 4. Konsistent.

**Bekannte manuelle Schritte (nicht automatisierbar, brauchen den Nutzer):** GitHub-Pages-Publish (Task 5 Step 3) + Default-Redirect einsetzen (Step 4); `.mcpb`-Installation und E2E-Login in Claude Desktop (Task 6 Step 5). Diese sind explizit als MANUELL markiert, damit die subagent-getriebene Ausführung dort sauber an den Nutzer übergibt.
