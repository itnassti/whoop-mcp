# shadcn Dashboard (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the WHOOP-MCP's server-rendered HTML dashboard with a React + Vite + Tailwind + shadcn/ui SPA that does the same four things (connect status, create PAT, list/revoke PATs, delete account) — prettier — talking to a new JSON API, while auth/OAuth/MCP stay unchanged.

**Architecture:** The SPA renders UI only and calls JSON endpoints under `/dashboard/api/*`. Auth stays exactly as today (same `cookie-session`, same `userId`, same OAuth redirect flow incl. the CSRF `state`). `/dashboard/connect` and `/dashboard/connected` remain server-side redirects. Express serves the built SPA (`web/dist`) statically under `/dashboard` with a fallback to `index.html`, mounted AFTER the API and connect routes.

**Tech Stack:** Existing: TypeScript, Node ≥22, Express, Drizzle/Postgres, `@modelcontextprotocol/sdk`, Vitest. New: Vite, React 19 + TS, Tailwind CSS v4, shadcn/ui, `sonner`, React Testing Library; npm workspaces.

## Global Constraints

- Node ≥22; TypeScript strict. Server code is ESM with `.js` import suffixes.
- Auth/OAuth/MCP behavior MUST NOT change. `/dashboard/connect`, `/dashboard/connected`, `/whoop/callback`, `/mcp`, `/.well-known/*`, `/authorize`, `/token` stay as-is.
- Never log token/secret values. Raw PATs are returned to the client exactly once (POST response) and stored only as SHA-256 hash.
- New write endpoints require `session.userId` (else 401) AND an `X-Requested-With` header (else 403).
- The API exposes a token's `tokenHash` as its `id` — never the raw token. Revoke/delete are user-scoped.
- Every task ends with a green test run and a commit. Commit trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Do NOT deploy until the final task; the live prod build changes and must be verified deliberately.

## Shared Types

```ts
// src/dashboard/api.ts (Task 2) — also mirrored in web/src/lib/api.ts (Task 4)
export interface TokenSummary {
  id: string;            // = mcpTokens.tokenHash (safe to expose; not the raw token)
  label: string | null;
  createdAt: string;     // ISO
  lastUsedAt: string | null; // ISO or null
}
```

## File Structure

```
src/auth/token-store.ts        # + listMcpTokens, revokeMcpTokenById (Task 1)
src/dashboard/api.ts           # NEW: JSON API router (Task 2)
src/dashboard/routes.ts        # keep cookie-session/connect/connected; drop HTML handlers; mount api + static (Tasks 2 & 5)
test/token-store.test.ts       # + list/revokeById tests (Task 1)
test/dashboard-api.test.ts     # NEW: API endpoint tests (Task 2)
web/                           # NEW Vite React app (Task 3)
  package.json, vite.config.ts, tsconfig*.json, components.json, index.html
  src/main.tsx, src/index.css, src/App.tsx
  src/lib/utils.ts, src/lib/api.ts
  src/components/ui/*           # shadcn-generated
  src/components/*.tsx          # ConnectCard, TokensCard, DangerZone, ThemeToggle (Task 4)
  src/App.test.tsx              # RTL tests (Task 4)
package.json                   # + "workspaces": ["web"], build script (Task 3 & 5)
```

---

## Task 1: TokenStore — list + user-scoped revoke by id

**Files:**
- Modify: `src/auth/token-store.ts`
- Test: `test/token-store.test.ts`

**Interfaces:**
- Consumes: existing `schema.mcpTokens` (columns: `tokenHash` PK, `userId`, `type` `'oauth'|'pat'`, `label`, `createdAt`, `lastUsedAt`, `revokedAt`).
- Produces:
  - `TokenSummary = { id: string; label: string | null; createdAt: string; lastUsedAt: string | null }` (exported).
  - `TokenStore.listMcpTokens(userId: string): Promise<TokenSummary[]>` — non-revoked `pat` tokens for the user, newest first.
  - `TokenStore.revokeMcpTokenById(userId: string, tokenHash: string): Promise<void>` — sets `revokedAt`, scoped to `userId` (no cross-user revoke).

- [ ] **Step 1: Write failing tests** (fake db mirroring the existing style in this file)

```ts
// append to test/token-store.test.ts
import { and, eq } from "drizzle-orm"; // (only if needed by fakes; otherwise omit)

describe("TokenStore.listMcpTokens / revokeMcpTokenById (fake db)", () => {
  it("listMcpTokens maps rows to TokenSummary (id = tokenHash, ISO dates)", async () => {
    const created = new Date("2026-08-01T10:00:00.000Z");
    const rows = [
      { tokenHash: "h1", userId: "u1", type: "pat", label: "cli", createdAt: created, lastUsedAt: null, revokedAt: null },
    ];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }),
    };
    const store = new TokenStore(db as any, key, vi.fn());
    const out = await store.listMcpTokens("u1");
    expect(out).toEqual([{ id: "h1", label: "cli", createdAt: created.toISOString(), lastUsedAt: null }]);
  });

  it("revokeMcpTokenById issues a scoped update (userId + tokenHash) setting revokedAt", async () => {
    let captured: any = null;
    const db = {
      update: () => ({ set: (patch: any) => ({ where: async () => { captured = patch; } }) }),
    };
    const store = new TokenStore(db as any, key, vi.fn());
    await store.revokeMcpTokenById("u1", "h1");
    expect(captured.revokedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run test/token-store.test.ts`)

- [ ] **Step 3: Implement** (add to `TokenStore`, import `and` from drizzle-orm)

```ts
// top of file: import { and, eq } from "drizzle-orm";
export interface TokenSummary {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

// inside class TokenStore:
async listMcpTokens(userId: string): Promise<TokenSummary[]> {
  const rows = await this.db.select().from(schema.mcpTokens)
    .where(and(
      eq(schema.mcpTokens.userId, userId),
      eq(schema.mcpTokens.type, "pat"),
      isNull(schema.mcpTokens.revokedAt),
    ))
    .orderBy(desc(schema.mcpTokens.createdAt));
  return rows.map((r) => ({
    id: r.tokenHash,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));
}

async revokeMcpTokenById(userId: string, tokenHash: string): Promise<void> {
  await this.db.update(schema.mcpTokens).set({ revokedAt: new Date() })
    .where(and(
      eq(schema.mcpTokens.tokenHash, tokenHash),
      eq(schema.mcpTokens.userId, userId),
    ));
}
```
Update the import line to `import { and, desc, eq, isNull } from "drizzle-orm";`.
**Note:** the fake-db test for `listMcpTokens` stubs `.where(...).orderBy(...)`; ensure the fake returns the rows from `orderBy`. Adjust the fake if the real chain differs.

- [ ] **Step 4: Run — expect PASS** + `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat: TokenStore listMcpTokens + user-scoped revokeMcpTokenById`

---

## Task 2: Dashboard JSON API + rewire dashboard router

**Files:**
- Create: `src/dashboard/api.ts`
- Modify: `src/dashboard/routes.ts` (drop HTML handlers `/`, `/pat`, `/pat/revoke`, `/delete`; keep `cookie-session`, `/connect`, `/connected`; mount API at `/api`)
- Create: `test/dashboard-api.test.ts`
- Modify: `test/dashboard.test.ts` (the old "GET / has Connect WHOOP" / "POST /pat 401" assertions no longer apply — replace with a state-guard test that still holds; see Step 6)

**Interfaces:**
- Consumes: `TokenStore.issueMcpToken`, `listMcpTokens`, `revokeMcpTokenById`, `deleteUser`; `TokenSummary` (Task 1).
- Produces: `createDashboardApiRouter(deps: { tokenStore: TokenStore }): express.Router` with:
  - `GET /session` → `{ connected: boolean }` (no auth; false if no session).
  - `GET /tokens` → 401 without session; else `{ tokens: TokenSummary[] }`.
  - `POST /tokens` → 401 without session, 403 without `X-Requested-With`; else issues a `pat`, returns `{ token }` once.
  - `DELETE /tokens/:id` → same guards; revokes user-scoped; 204.
  - `DELETE /account` → same guards; deletes user + clears session; 204.

- [ ] **Step 1: Write failing API tests**

```ts
// test/dashboard-api.test.ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieSession from "cookie-session";
import { createDashboardApiRouter } from "../src/dashboard/api.js";

function appWith(tokenStore: any, seedUserId?: string) {
  const a = express();
  a.use(cookieSession({ name: "s", secret: "x".repeat(20) }));
  if (seedUserId) a.use((req, _res, next) => { (req.session as any).userId = seedUserId; next(); });
  a.use("/api", createDashboardApiRouter({ tokenStore }));
  return a;
}

describe("dashboard API", () => {
  it("GET /api/session reports connected=false without a session user", async () => {
    const r = await request(appWith({})).get("/api/session");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ connected: false });
  });

  it("GET /api/tokens is 401 without a session", async () => {
    const r = await request(appWith({})).get("/api/tokens");
    expect(r.status).toBe(401);
  });

  it("POST /api/tokens is 403 without X-Requested-With", async () => {
    const issueMcpToken = vi.fn();
    const r = await request(appWith({ issueMcpToken }, "u1")).post("/api/tokens");
    expect(r.status).toBe(403);
    expect(issueMcpToken).not.toHaveBeenCalled();
  });

  it("POST /api/tokens issues a pat and returns it once", async () => {
    const issueMcpToken = vi.fn(async () => "whoopmcp_pat_abc");
    const r = await request(appWith({ issueMcpToken }, "u1"))
      .post("/api/tokens").set("X-Requested-With", "fetch").send({ label: "cli" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ token: "whoopmcp_pat_abc" });
    expect(issueMcpToken).toHaveBeenCalledWith("u1", "pat", "cli");
  });

  it("GET /api/tokens lists summaries for the session user", async () => {
    const listMcpTokens = vi.fn(async () => [{ id: "h1", label: "cli", createdAt: "2026-08-01T10:00:00.000Z", lastUsedAt: null }]);
    const r = await request(appWith({ listMcpTokens }, "u1")).get("/api/tokens");
    expect(r.status).toBe(200);
    expect(r.body.tokens[0].id).toBe("h1");
    expect(listMcpTokens).toHaveBeenCalledWith("u1");
  });

  it("DELETE /api/tokens/:id revokes user-scoped (204)", async () => {
    const revokeMcpTokenById = vi.fn(async () => undefined);
    const r = await request(appWith({ revokeMcpTokenById }, "u1"))
      .delete("/api/tokens/h1").set("X-Requested-With", "fetch");
    expect(r.status).toBe(204);
    expect(revokeMcpTokenById).toHaveBeenCalledWith("u1", "h1");
  });

  it("DELETE /api/account deletes the user (204)", async () => {
    const deleteUser = vi.fn(async () => undefined);
    const r = await request(appWith({ deleteUser }, "u1"))
      .delete("/api/account").set("X-Requested-With", "fetch");
    expect(r.status).toBe(204);
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement the API router**

```ts
// src/dashboard/api.ts
import express, { Router, type Request, type Response, type NextFunction } from "express";
import type { TokenStore } from "../auth/token-store.js";

export interface DashboardApiDeps {
  tokenStore: TokenStore;
}

function userId(req: Request): string | undefined {
  return req.session?.userId as string | undefined;
}
function requireSession(req: Request, res: Response): string | undefined {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "not connected" }); return undefined; }
  return id;
}
function requireXhr(req: Request, res: Response): boolean {
  if (!req.get("x-requested-with")) { res.status(403).json({ error: "missing X-Requested-With" }); return false; }
  return true;
}

export function createDashboardApiRouter(deps: DashboardApiDeps): Router {
  const router = Router();
  router.use(express.json());

  router.get("/session", (req, res) => {
    res.json({ connected: Boolean(userId(req)) });
  });

  router.get("/tokens", async (req, res) => {
    const id = requireSession(req, res); if (!id) return;
    res.json({ tokens: await deps.tokenStore.listMcpTokens(id) });
  });

  router.post("/tokens", async (req, res) => {
    const id = requireSession(req, res); if (!id) return;
    if (!requireXhr(req, res)) return;
    const label = typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label.trim() : undefined;
    const token = await deps.tokenStore.issueMcpToken(id, "pat", label);
    res.json({ token });
  });

  router.delete("/tokens/:id", async (req, res) => {
    const id = requireSession(req, res); if (!id) return;
    if (!requireXhr(req, res)) return;
    await deps.tokenStore.revokeMcpTokenById(id, req.params.id);
    res.status(204).end();
  });

  router.delete("/account", async (req, res) => {
    const id = requireSession(req, res); if (!id) return;
    if (!requireXhr(req, res)) return;
    await deps.tokenStore.deleteUser(id);
    req.session = null;
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: Rewire `src/dashboard/routes.ts`** — keep the top (imports, `DashboardDeps`, `cookieSession`, `/connect`, `/connected`); REMOVE the `page()` helper and the `/`, `/pat`, `/pat/revoke`, `/delete` handlers; mount the API. Result:

```ts
// keep existing imports + add:
import { createDashboardApiRouter } from "./api.js";
// ... inside createDashboardRouter, AFTER cookieSession + urlencoded and the /connect + /connected routes:
router.use("/api", createDashboardApiRouter({ tokenStore: deps.tokenStore }));
return router;
```
(Static SPA serving is added in Task 5. Until then, `GET /dashboard` has no handler — that is expected; the API is independently testable.)

- [ ] **Step 5: Run API tests — expect PASS**

- [ ] **Step 6: Replace stale assertions in `test/dashboard.test.ts`** — the "GET / shows Connect WHOOP" and "POST /pat 401" tests are gone. Keep the CSRF-state test (it still holds) and drop the two obsolete ones. Run `npx vitest run test/dashboard.test.ts` — PASS. Full suite + `tsc` clean.

- [ ] **Step 7: Commit** — `feat: dashboard JSON API; drop server-rendered HTML handlers`

---

## Task 3: Scaffold the web app (Vite + Tailwind v4 + shadcn) + workspaces

**Files:**
- Create: `web/` (Vite React-TS project), `web/components.json`, Tailwind + alias config
- Modify: root `package.json` (`workspaces`, build script), root `.gitignore` (`web/dist`, `web/node_modules`)

**REQUIRED SUB-SKILL for this task:** load `vercel:shadcn` for the current, exact shadcn + Vite + Tailwind v4 setup commands (versions move fast — follow the skill over any memorized command).

**Interfaces:**
- Produces: a buildable `web/` app (`npm run build -w web` → `web/dist/`) rendering a placeholder; path alias `@/*` → `web/src/*`; Vite `base: "/dashboard/"`.

- [ ] **Step 1: Scaffold Vite React-TS app** in `web/`

```bash
npm create vite@latest web -- --template react-ts
```

- [ ] **Step 2: Install Tailwind v4 + shadcn deps and init** — follow `vercel:shadcn`. Expected shape:
  - `npm i -D tailwindcss @tailwindcss/vite -w web` and add the Tailwind Vite plugin to `web/vite.config.ts`.
  - `web/src/index.css` starts with `@import "tailwindcss";`.
  - Path alias in `web/tsconfig.json` + `web/tsconfig.app.json` (`"paths": { "@/*": ["./src/*"] }`) and in `web/vite.config.ts` (`resolve.alias { "@": "/src" }` via `path.resolve`).
  - `npx shadcn@latest init` (choose defaults; TypeScript; CSS variables) → writes `web/components.json`, `web/src/lib/utils.ts`, base CSS variables.

- [ ] **Step 3: Set Vite base + build output**

```ts
// web/vite.config.ts — ensure:
export default defineConfig({
  base: "/dashboard/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: { outDir: "dist" },
});
```

- [ ] **Step 4: Add shadcn components used by the UI**

```bash
npx shadcn@latest add button card dialog alert-dialog table input sonner
```

- [ ] **Step 5: Wire npm workspaces** — root `package.json`:

```jsonc
{
  "workspaces": ["web"],
  "scripts": {
    // keep existing dev/start/test/db:*; update build:
    "build": "tsc && npm run build -w web"
  }
}
```
Add to root `.gitignore`: `web/dist` and `web/node_modules`.

- [ ] **Step 6: Verify build** — from repo root: `npm install` (links workspace), then `npm run build` → produces `dist/` (server) AND `web/dist/index.html` + assets. Confirm `web/dist/index.html` references `/dashboard/…` asset URLs (because of `base`).

- [ ] **Step 7: Commit** — `chore: scaffold web app (vite + tailwind v4 + shadcn) as workspace`

---

## Task 4: Build the dashboard UI

**Files:**
- Create: `web/src/lib/api.ts`, `web/src/components/ConnectCard.tsx`, `TokensCard.tsx`, `DangerZone.tsx`, `ThemeToggle.tsx`
- Modify: `web/src/App.tsx`, `web/src/main.tsx` (mount `<Toaster/>`)
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: the JSON API (Task 2). `TokenSummary` mirrored here.

- [ ] **Step 1: API client**

```ts
// web/src/lib/api.ts
export interface TokenSummary { id: string; label: string | null; createdAt: string; lastUsedAt: string | null; }

const H = { "X-Requested-With": "fetch", "Content-Type": "application/json" };
async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
export const api = {
  session: () => fetch("/dashboard/api/session", { credentials: "include" }).then(j<{ connected: boolean }>),
  listTokens: () => fetch("/dashboard/api/tokens", { credentials: "include" }).then(j<{ tokens: TokenSummary[] }>),
  createToken: (label?: string) =>
    fetch("/dashboard/api/tokens", { method: "POST", credentials: "include", headers: H, body: JSON.stringify({ label }) }).then(j<{ token: string }>),
  revokeToken: (id: string) =>
    fetch(`/dashboard/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", headers: H }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); }),
  deleteAccount: () =>
    fetch("/dashboard/api/account", { method: "DELETE", credentials: "include", headers: H }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); }),
};
export const connectUrl = "/dashboard/connect";
```

- [ ] **Step 2: Components** — build with shadcn primitives:
  - `ConnectCard`: `Card` with copy about WHOOP + a `Button` as `<a href={connectUrl}>Connect WHOOP</a>`.
  - `TokensCard`: fetches `listTokens` on mount; renders a `Table` of tokens (label, createdAt, lastUsedAt, revoke `Button` → `AlertDialog` → `revokeToken` → refresh + `toast`); a "Create token" `Button` → `createToken` → open a `Dialog` showing the raw token in `<code>` with a Copy button + "shown once" warning → on close, refresh list.
  - `DangerZone`: `Card` with a destructive `Button` → `AlertDialog` → `deleteAccount` → on success reload to connect state + `toast`.
  - `ThemeToggle`: toggles a `dark` class on `document.documentElement`, persists to `localStorage`.
  - `App`: on mount call `api.session()`; while loading show a spinner; if `connected` render `<TokensCard/>` + `<DangerZone/>`, else `<ConnectCard/>`. Header shows app name + `<ThemeToggle/>`. A 401 thrown from any call flips state back to not-connected.
  - `main.tsx`: render `<App/>` and `<Toaster/>` (from `sonner`).

- [ ] **Step 3: Component tests (RTL)** — `web/src/App.test.tsx`, mocking `fetch`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";

beforeEach(() => { vi.restoreAllMocks(); });

it("shows Connect WHOOP when not connected", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ connected: false }), { status: 200 }));
  render(<App />);
  await waitFor(() => expect(screen.getByText(/connect whoop/i)).toBeInTheDocument());
});

it("shows the tokens card when connected", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
    String(url).endsWith("/session")
      ? new Response(JSON.stringify({ connected: true }), { status: 200 })
      : new Response(JSON.stringify({ tokens: [] }), { status: 200 }));
  render(<App />);
  await waitFor(() => expect(screen.getByText(/personal access tokens/i)).toBeInTheDocument());
});
```
Ensure the web app has a test setup for RTL (`@testing-library/react`, `@testing-library/jest-dom`, jsdom env in `web/vite.config.ts` test block or a `vitest.config.ts` in `web/`). Follow `vercel:shadcn`/Vite testing defaults.

- [ ] **Step 4: Run** — `npm run test -w web` (component tests pass); `npm run build -w web` clean.
- [ ] **Step 5: Commit** — `feat: shadcn dashboard UI (connect, tokens, danger zone, theme)`

---

## Task 5: Serve the SPA from Express + full build wiring

**Files:**
- Modify: `src/dashboard/routes.ts` (add static serving + SPA fallback, ordered AFTER `/connect`, `/connected`, `/api`)
- Test: `test/dashboard.test.ts` (add a static-serving assertion using a temp `web/dist`)

**Interfaces:**
- Consumes: everything above; `web/dist/index.html` produced by Task 3/4.

- [ ] **Step 1: Add static serving to the dashboard router** (after the `/api` mount, before `return router`)

```ts
import path from "node:path";
import express from "express"; // already imported
// ...
const webDist = path.resolve("web/dist"); // resolved from process.cwd() (repo root locally, /app on Railway)
router.use(express.static(webDist));
// SPA fallback: any other GET under /dashboard serves index.html (client renders states).
router.get(/.*/, (req, res, next) => {
  if (req.method !== "GET") return next();
  res.sendFile(path.join(webDist, "index.html"));
});
```
Ordering guarantee: `/connect`, `/connected`, and `/api/*` are registered earlier in the router, so Express matches them before this catch-all. `express.static` serves real asset files; the fallback covers `/dashboard` and unknown client paths.

- [ ] **Step 2: Test static serving** — write `web/dist/index.html` fixture in the test (or build once) and assert `GET /dashboard/` returns it:

```ts
// in test/dashboard.test.ts — add:
import fs from "node:fs";
import path from "node:path";
it("serves the SPA index.html at the dashboard root", async () => {
  const dist = path.resolve("web/dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>WHOOP</title><div id=root></div>");
  const a = express();
  a.use("/dashboard", createDashboardRouter({ provider: {} as any, tokenStore: {} as any, sessionSecret: "x".repeat(20) }));
  const r = await request(a).get("/dashboard/");
  expect(r.status).toBe(200);
  expect(r.text).toMatch(/id=root/);
});
```
(If a real `web/dist` already exists from Task 4's build, the fixture write is harmless.)

- [ ] **Step 3: Run full suite + `tsc`** — all green.
- [ ] **Step 4: Local end-to-end sanity** — `npm run build` at root, then `PORT=8080 DATABASE_URL=… ENCRYPTION_KEY=… SESSION_SECRET=… WHOOP_CLIENT_ID=… WHOOP_CLIENT_SECRET=… PUBLIC_BASE_URL=http://localhost:8080 npm start`, open `http://localhost:8080/dashboard` → SPA loads, shows Connect state. (DB not required for the SPA shell; `/api/session` returns `{connected:false}`.)
- [ ] **Step 5: Commit** — `feat: serve shadcn SPA from Express under /dashboard`

---

## Task 6: Deploy + live verification (manual, not automated)

- [ ] Redeploy to Railway (`railway up --service whoop-mcp-server --detach`) and poll to `SUCCESS`. Confirm the Nixpacks build ran BOTH `tsc` and the Vite build (check build logs for `vite build` / `web/dist`).
- [ ] `GET /healthz` → 200; `GET /dashboard/` → SPA HTML (200).
- [ ] In an incognito window: `/dashboard` → Connect state → Connect WHOOP → back to dashboard shows the tokens UI.
- [ ] Create a PAT via the UI → copy → call an MCP tool with it (`get_profile`) → real data. Revoke it in the UI → the same PAT now 401s at `/mcp`.
- [ ] Confirm the existing OAuth/MCP flows still work (discovery 200, `/mcp` 401 without token).

If the Nixpacks build does not pick up the workspace/Vite build, add an explicit build in `railway.json` (`"buildCommand": "npm ci && npm run build"`) and redeploy.

---

## Self-Review (author)

- **Spec coverage:** §2 API → Task 2; §3 build/workspaces/static → Tasks 3 & 5; §4 backend methods → Task 1, router → Task 2; §5 security (401/403/X-Requested-With/user-scoped) → Task 2 tests; §6 UI components → Task 4; §7 error handling → Task 4 (toasts, 401→connect); §8 tests → each task; §9 verification → Tasks 3/5/6. All covered.
- **Placeholder scan:** shadcn component generation is a real CLI step (not a placeholder); the `vercel:shadcn` skill supplies exact current commands. Backend/API/wiring code is concrete.
- **Type consistency:** `TokenSummary { id, label, createdAt, lastUsedAt }` identical in Task 1 (server) and Task 4 (`web/src/lib/api.ts`); `id` = `tokenHash` throughout; `createDashboardApiRouter({ tokenStore })` matches its mount in Task 2.
- **Risk:** production build pipeline changes — Task 6 verifies it explicitly and has the `railway.json` fallback.
