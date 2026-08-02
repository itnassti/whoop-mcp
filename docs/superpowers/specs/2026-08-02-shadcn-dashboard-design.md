# shadcn Dashboard (v1) — Design-Dokument

**Datum:** 2026-08-02
**Status:** Genehmigt (Brainstorming), bereit für Implementation-Plan
**Kontext:** Ersetzt das server-gerenderte HTML-Dashboard des WHOOP-MCP durch ein React/shadcn-Frontend. Auth/OAuth/MCP bleiben unverändert.

## 1. Ziel & Umfang

Das bestehende Dashboard ([src/dashboard/routes.ts](../../../src/dashboard/routes.ts)) liefert 4 Funktionen als reine HTML-Strings aus: Connect-Status, PAT erzeugen, PAT revoke, Account löschen. Dieses v1 ersetzt die **UI** durch eine React + Vite + Tailwind + shadcn/ui SPA — **dieselben Funktionen, hübsch** — ohne Datenabrufe/Charts (die kommen als eigener späterer Block).

**Nicht in v1 (YAGNI):** WHOOP-Datenabrufe/Charts, User-Login jenseits von WHOOP, tiefes Client-Routing, SSR.

## 2. Architektur

Die SPA rendert nur UI und ruft JSON-Endpunkte. **Auth bleibt exakt wie jetzt**: dieselbe `cookie-session`, dieselbe `userId`, derselbe OAuth-Redirect-Flow inkl. des CSRF-`state` (Commit 4080b06). „Connect WHOOP" ist in der SPA ein Link auf `/dashboard/connect` (Server macht OAuth). Nach `/connected` (setzt Session) landet der Browser zurück auf der SPA, die per `/api/session` „connected" erkennt.

```
Express (whoop-mcp-server):
  /mcp                         MCP (unverändert)
  /.well-known /authorize /token /whoop/callback   OAuth (unverändert)
  /dashboard/connect           302 -> WHOOP (server, unverändert)
  /dashboard/connected         setzt Session, 302 -> /dashboard (unverändert)
  NEU JSON-API:
    GET    /dashboard/api/session      -> { connected: boolean }
    GET    /dashboard/api/tokens       -> { tokens: TokenSummary[] }
    POST   /dashboard/api/tokens       -> { token: string }   (Roh-PAT einmalig)
    DELETE /dashboard/api/tokens/:id   -> 204
    DELETE /dashboard/api/account      -> 204
  /dashboard  und /dashboard/*         statische SPA-Assets (web/dist), SPA-Fallback auf index.html
```

`TokenSummary = { id: string; label: string | null; createdAt: string; lastUsedAt: string | null }`.
`id` ist die `tokenHash`-PK (nie der Roh-Token); Revoke per `id`.

## 3. Wo der Code lebt + Build

- **`web/`** — eigenes Vite + React + TS + Tailwind + shadcn Projekt, baut nach `web/dist/`. Vite `base: "/dashboard/"`.
- **npm workspaces:** Root-`package.json` erhält `"workspaces": ["web"]`; `npm ci` installiert Root + `web`. Root-`build` = `tsc && npm run build -w web`.
- **Express** serviert `web/dist` statisch unter `/dashboard` mit SPA-Fallback (unbekannte `/dashboard/*`-Pfade -> `index.html`), aber `/dashboard/api/*`, `/dashboard/connect`, `/dashboard/connected` bleiben echte Server-Routen (vor dem statischen Fallback gemountet).
- **Railway:** Build macht Server-`tsc` **und** Vite-Build; Start unverändert (`db:migrate && start`).
- **Risiko:** ändert die aktuell funktionierende Build-Pipeline. Mitigation: Deploy nach dem Umbau explizit verifizieren (healthz 200, SPA lädt unter `/dashboard`, PAT create→list→revoke Roundtrip, ein MCP-Tool-Call mit bestehendem PAT).

## 4. Backend-Erweiterungen

- `TokenStore.listMcpTokens(userId: string): Promise<TokenSummary[]>` — nur nicht-widerrufene `pat`-Tokens des Users (Hash als `id`), sortiert nach `createdAt` desc.
- `TokenStore.revokeMcpTokenById(userId: string, tokenHash: string): Promise<void>` — setzt `revokedAt`, **scoped auf den User** (kein Fremd-Revoke). Der bestehende `revokeMcpToken(raw)` bleibt für den alten Flow, wird von der neuen API aber nicht genutzt.
- Neue Router-Datei [src/dashboard/api.ts](../../../src/dashboard/api.ts): `createDashboardApiRouter({ tokenStore })` mit den 4 JSON-Endpunkten. Wird im Dashboard-Router hinter der `cookie-session` gemountet.
- [src/dashboard/routes.ts](../../../src/dashboard/routes.ts): behält `cookie-session`, `/connect`, `/connected`; die HTML-Seiten-Handler (`/`, `/pat`, `/pat/revoke`, `/delete`) werden durch das statische SPA-Serving + die JSON-API ersetzt. `/connect` und `/connected` bleiben unverändert.

## 5. Sicherheit

- Alle `/dashboard/api/*` hinter derselben `cookie-session`; schreibende Endpunkte (POST/DELETE) verlangen `session.userId`, sonst 401.
- **CSRF:** `sameSite:"lax"`-Cookie + JSON-`Content-Type` (fetch) verhindert Cross-Site-Formular-POSTs. Zusätzlich verlangen schreibende Routen einen `X-Requested-With: fetch`-Header (Custom-Header sind cross-origin ohne CORS-Preflight-Freigabe nicht setzbar) als zweite Barriere.
- Revoke/Delete sind **user-scoped** (nur eigene Tokens/eigener Account).
- Roh-PAT nur in der POST-Antwort (einmalig), nie geloggt; DB speichert nur den SHA-256-Hash (wie bisher).

## 6. UI-Komponenten (shadcn)

- **Nicht verbunden:** zentrierte `Card` + Erklärung + großer „Connect WHOOP"-`Button` (Link auf `/dashboard/connect`).
- **Verbunden:**
  - `Card` „Personal Access Tokens": Liste/`Table` aktiver PATs (Label, erstellt, zuletzt genutzt) + „Create token"-`Button`. Neuer Token einmalig in `Dialog` mit Copy-Button + Warnhinweis. Revoke pro Zeile mit `AlertDialog`-Bestätigung.
  - `Card` „Danger Zone": „Delete account" mit `AlertDialog`.
- **Global:** Header mit App-Name + Light/Dark-Toggle (shadcn-Theming/CSS-Variablen), `sonner`-Toasts für Erfolg/Fehler.
- **Eine Seite mit Zuständen** (kein Router). Datenfluss: beim Laden `GET /api/session`; wenn connected `GET /api/tokens`; Aktionen rufen die POST/DELETE-Endpunkte und aktualisieren die Liste.

## 7. Fehlerbehandlung

- API gibt bei Fehlern JSON `{ error: string }` + passenden Status; die SPA zeigt `sonner`-Toast.
- 401 auf einem API-Call (Session abgelaufen) -> SPA fällt in den „nicht verbunden"-Zustand zurück.
- Netzwerk-/Serverfehler -> generischer Toast, kein Absturz.

## 8. Tests

- **Backend (Vitest/supertest):** `listMcpTokens`/`revokeMcpTokenById` (fake-db bzw. skipIf-Integration); die 4 API-Endpunkte: 401 ohne Session, PAT create→list→revoke, account delete, fehlender `X-Requested-With` -> abgewiesen.
- **Frontend (Vitest + React Testing Library):** leichtgewichtig — „nicht verbunden zeigt Connect-Button" und „Token-Dialog zeigt Roh-Token + Copy". Kein schweres E2E in v1.

## 9. Offene Verifikationspunkte während Umsetzung

- Vite `base` + Express-Static-Mount so, dass Assets korrekt unter `/dashboard/` geladen werden und der SPA-Fallback die API-Routen nicht überschattet.
- shadcn-Setup in einem Vite-Projekt (nicht Next): `components.json`, Tailwind-Config, Pfad-Aliase.
- Railway/Nixpacks baut das Workspace korrekt (installiert `web`-Deps, führt Vite-Build aus).
