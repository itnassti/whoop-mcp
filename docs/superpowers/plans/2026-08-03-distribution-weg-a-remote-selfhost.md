# Distribution Weg A — Remote / Self-Host — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den bestehenden WHOOP-MCP-Server als self-hostbaren Remote-Connector auslieferbar machen — 1-Click auf Railway plus Anleitung für andere Hosts — ohne den Server umzubauen.

**Architecture:** Der bestehende Express-/OAuth-Server bleibt unverändert. Einziger Code-Eingriff: `PUBLIC_BASE_URL` fällt auf Railways `RAILWAY_PUBLIC_DOMAIN` zurück. Alles Weitere ist additiv: LICENSE, ein Dockerfile für beliebige Hosts, ein Railway-Deploy-Template mit auto-generierten Secrets, und ein restrukturierter README-Guide. Der Shared-Core-Refactor gehört zu Weg B (Plan 2) und ist hier **nicht** enthalten.

**Tech Stack:** Node ≥22, TypeScript, Express 5, Drizzle/Postgres, Zod, Vitest, Railway (Nixpacks + Template-Funktionen), Docker.

## Global Constraints

- **Node-Version:** `engines.node >=22` bleibt gesetzt (Web-Crypto-Global zur Laufzeit nötig). Nicht senken.
- **`ENCRYPTION_KEY`:** exakt 32-Byte-Hex (Regex `^[0-9a-fA-F]{64}$` in [src/config.ts](../../../src/config.ts)). Railway-Template generiert genau dieses Format.
- **`SESSION_SECRET`:** mindestens 16 Zeichen.
- **WHOOP-Redirect-URI:** immer `https://<host>/whoop/callback` (WHOOP erlaubt nur `https://`/`whoop://`, kein `http://localhost`).
- **WHOOP-Scopes (vollständig):** `read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement offline`.
- **Bestehende Instanz darf nicht brechen:** jede Änderung ist additiv oder reiner Fallback; die volle Test-Suite (`npm test`) muss vor und nach jedem Task grün sein.
- **Lizenz:** MIT.

---

### Task 1: LICENSE (MIT) + package.json-Metadaten

**Files:**
- Create: `LICENSE`
- Modify: `package.json:17-20` (Felder `license`, `author`, `description`, `keywords`)

**Interfaces:**
- Consumes: nichts.
- Produces: nichts (reine Repo-Hygiene).

- [ ] **Step 1: LICENSE-Datei anlegen**

Standard-MIT-Text, Jahr `2026`, Copyright-Halter `Christian Axtmann`:

```
MIT License

Copyright (c) 2026 Christian Axtmann

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: package.json-Metadaten setzen**

In [package.json](../../../package.json) die leeren/ISC-Felder ersetzen:

```json
  "keywords": ["mcp", "whoop", "model-context-protocol"],
  "author": "Christian Axtmann",
  "license": "MIT",
  "description": "Multi-user MCP server exposing WHOOP fitness data to AI clients.",
```

- [ ] **Step 3: Sicherstellen, dass nichts bricht**

Run: `npm test`
Expected: PASS (unverändert — nur Metadaten geändert).

- [ ] **Step 4: Commit**

```bash
git add LICENSE package.json
git commit -m "chore: add MIT license and fill package metadata"
```

---

### Task 2: `PUBLIC_BASE_URL`-Fallback auf `RAILWAY_PUBLIC_DOMAIN`

**Files:**
- Modify: `src/config.ts:20-28` (Funktion `loadConfig`)
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: bestehende `loadConfig(env: NodeJS.ProcessEnv): AppConfig`.
- Produces: unverändertes `AppConfig` (keine neuen Felder). Neues Verhalten: `publicBaseUrl` wird aus `RAILWAY_PUBLIC_DOMAIN` abgeleitet, wenn `PUBLIC_BASE_URL` fehlt.

- [ ] **Step 1: Failing tests schreiben**

In [test/config.test.ts](../../../test/config.test.ts) innerhalb des `describe("loadConfig")` ergänzen:

```ts
  it("derives PUBLIC_BASE_URL from RAILWAY_PUBLIC_DOMAIN when unset", () => {
    const { PUBLIC_BASE_URL, ...rest } = base;
    const c = loadConfig({ ...rest, RAILWAY_PUBLIC_DOMAIN: "app.up.railway.app" } as any);
    expect(c.publicBaseUrl).toBe("https://app.up.railway.app");
  });

  it("prefers explicit PUBLIC_BASE_URL over RAILWAY_PUBLIC_DOMAIN", () => {
    const c = loadConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: "other.up.railway.app" } as any);
    expect(c.publicBaseUrl).toBe("https://example.com");
  });

  it("throws when neither PUBLIC_BASE_URL nor RAILWAY_PUBLIC_DOMAIN is set", () => {
    const { PUBLIC_BASE_URL, ...rest } = base;
    expect(() => loadConfig(rest as any)).toThrow();
  });
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — die ersten beiden neuen Tests scheitern (aktuell wird `RAILWAY_PUBLIC_DOMAIN` ignoriert, und ohne `PUBLIC_BASE_URL` wirft `Schema.parse` bereits — der dritte Test wäre schon grün).

- [ ] **Step 3: Ableitung implementieren**

In [src/config.ts](../../../src/config.ts) `loadConfig` so ändern, dass der Fallback vor `Schema.parse` greift:

```ts
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const publicBaseUrl =
    env.PUBLIC_BASE_URL ??
    (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  const p = Schema.parse({ ...env, PUBLIC_BASE_URL: publicBaseUrl });
  return {
    databaseUrl: p.DATABASE_URL, encryptionKey: p.ENCRYPTION_KEY,
    whoopClientId: p.WHOOP_CLIENT_ID, whoopClientSecret: p.WHOOP_CLIENT_SECRET,
    publicBaseUrl: p.PUBLIC_BASE_URL, port: Number(p.PORT),
    sessionSecret: p.SESSION_SECRET,
  };
}
```

(`Schema` ist ein `z.object` und strippt unbekannte Keys, daher ist das Spreaden von `env` unproblematisch.)

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (alle, inkl. der bestehenden).

- [ ] **Step 5: Volle Suite absichern**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): derive PUBLIC_BASE_URL from RAILWAY_PUBLIC_DOMAIN as fallback"
```

---

### Task 3: Dockerfile für beliebige Hosts

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: bestehende npm-Scripts `build`, `db:migrate`, `start` aus [package.json](../../../package.json).
- Produces: ein lauffähiges Image, das per Env-Vars (siehe Global Constraints + [.env.example](../../../.env.example)) konfiguriert wird. Wird im README als „andere Hosts"-Pfad referenziert (Task 4).

- [ ] **Step 1: Dockerfile schreiben**

```dockerfile
FROM node:22-slim
WORKDIR /app

# Manifeste zuerst für Layer-Caching (Root + web-Workspace)
COPY package*.json ./
COPY web/package*.json ./web/
RUN npm ci

# Rest kopieren und Server + Web-SPA bauen
COPY . .
RUN npm run build

EXPOSE 8080
CMD ["sh", "-c", "npm run db:migrate && npm start"]
```

- [ ] **Step 2: .dockerignore schreiben**

```
node_modules
web/node_modules
dist
web/dist
.git
docs
example-export
*.log
```

- [ ] **Step 3: Image bauen (manuelle Verifikation)**

Run: `docker build -t whoop-mcp .`
Expected: Build läuft durch bis „exporting layers"; `npm run build` erzeugt `dist/` und `web/dist/` im Image ohne Fehler.

- [ ] **Step 4: Container gegen eine Test-DB smoke-testen (manuell, optional)**

Wenn eine erreichbare Postgres-URL vorliegt:
Run:
```bash
docker run --rm -p 8080:8080 \
  -e DATABASE_URL="postgres://…" \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e WHOOP_CLIENT_ID="x" -e WHOOP_CLIENT_SECRET="y" \
  -e PUBLIC_BASE_URL="http://localhost:8080" \
  whoop-mcp
```
Dann in einem zweiten Terminal: `curl -s localhost:8080/healthz`
Expected: `{"ok":true}` (Migrationen laufen beim Start, Server lauscht auf 8080).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: add Dockerfile and .dockerignore for self-hosting on any container host"
```

---

### Task 4: Railway-Deploy-Template + restrukturierter README-Guide

Dieser Task hat einen **Repo-Anteil** (README) und einen **Railway-Plattform-Anteil** (Template im Railway-Dashboard erstellen). Der Plattform-Anteil ist nicht unit-testbar; Verifikation erfolgt über einen echten Deploy.

**Files:**
- Modify: `README.md` (vollständige Restrukturierung entlang der realen Abläufe)

**Interfaces:**
- Consumes: `PUBLIC_BASE_URL`-Fallback aus Task 2, Dockerfile aus Task 3.
- Produces: eine öffentliche Template-URL (`https://railway.com/deploy/<slug>`) für den „Deploy on Railway"-Button.

- [ ] **Step 1: Railway-Template im Dashboard anlegen (manuell)**

Auf `railway.com` → New Template → aus diesem Repo. Im Template konfigurieren:
- **Service** aus dem Repo (Nixpacks, bestehende [railway.json](../../../railway.json) übernimmt Build/Start).
- **Postgres**-Plugin hinzufügen.
- **Variablen** des App-Service:
  - `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
  - `ENCRYPTION_KEY = ${{ secret(64, "abcdef0123456789") }}` (→ 32-Byte-Hex, äquivalent `openssl rand -hex 32`)
  - `SESSION_SECRET = ${{ secret(64, "abcdef0123456789") }}`
  - `WHOOP_CLIENT_ID` = leer, als Pflicht-Eingabe markiert
  - `WHOOP_CLIENT_SECRET` = leer, als Pflicht-Eingabe markiert
  - `PUBLIC_BASE_URL` **nicht** setzen (wird via Task 2 aus `RAILWAY_PUBLIC_DOMAIN` abgeleitet).
- Template veröffentlichen → **Template-URL notieren** für Step 3.

- [ ] **Step 2: Deploy aus dem Template verifizieren (manuell)**

Frische Instanz aus der Template-URL deployen, WHOOP-Creds eintragen.
Expected:
- `ENCRYPTION_KEY` / `SESSION_SECRET` sind automatisch mit 64-Hex-Werten befüllt.
- `GET https://<neue-domain>/healthz` → `{"ok":true}`.
- `GET https://<neue-domain>/.well-known/oauth-authorization-server` → 200.
- `GET https://<neue-domain>/mcp` ohne Token → 401.

- [ ] **Step 3: README vollständig restrukturieren**

[README.md](../../../README.md) neu gliedern in genau diese Abschnitte (Inhalte konkret, keine Platzhalter):

1. **Titel + Kurzbeschreibung** (aus bestehendem README übernehmen).
2. **„Zwei Wege, den Server zu nutzen"** — kurzer Absatz: (A) selbst hosten als Remote-Connector (dieses README), (B) lokale Claude-Desktop-Extension (Verweis „kommt separat / siehe Weg B", noch kein Link nötig).
3. **„1-Click auf Railway"** mit Button:
   ```markdown
   [![Deploy on Railway](https://railway.com/button.svg)](<TEMPLATE_URL aus Step 1>)
   ```
   Danach der nummerierte Ablauf:
   1. Button klicken → App + Postgres werden provisioniert, `ENCRYPTION_KEY`/`SESSION_SECRET` automatisch generiert.
   2. Railway-Domain kopieren.
   3. **WHOOP-App anlegen** (eigener Unterabschnitt, siehe Step 4).
   4. `WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET` in Railway eintragen → Redeploy.
   5. Client verbinden (Abschnitt 6).
4. **„WHOOP-App anlegen"** — Portal `developer.whoop.com`, App erstellen, Redirect-URI `https://<deine-domain>/whoop/callback`, Scopes: `read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement offline`, Client-ID/Secret kopieren.
5. **„Auf anderen Hosts betreiben"** — Tabelle der Pflicht-Env-Vars (aus Global Constraints) + drei Kurzrezepte:
   - **Docker/eigener VPS:** `docker build -t whoop-mcp . && docker run -p 8080:8080 --env-file .env whoop-mcp` (Env-Vars aus [.env.example](../../../.env.example); `PUBLIC_BASE_URL` hier **explizit** setzen, da kein `RAILWAY_PUBLIC_DOMAIN`).
   - **Fly.io:** `fly launch` nutzt das Dockerfile; Secrets via `fly secrets set …`; Postgres via `fly postgres create`.
   - **Render:** Web Service aus dem Repo (Docker), Postgres-Add-on, Env-Vars im Dashboard.
6. **„AI-Client verbinden"** — zwei Unterabschnitte:
   - **Browser (Claude.ai / ChatGPT):** Remote-Connector hinzufügen → `https://<deine-domain>/mcp` → OAuth-Flow „Connect WHOOP" durchklicken.
   - **Claude Desktop (Remote):** denselben Connector-URL eintragen.
   Optional (bestehend): lokale Clients per PAT — den vorhandenen `mcp.json`-Snippet aus dem alten README übernehmen.

- [ ] **Step 4: Links & Snippets gegenlesen**

Sicherstellen: alle Codeblöcke sind vollständig, die Template-URL ist eingesetzt, die Scope-Liste stimmt mit den Global Constraints überein, keine „TODO"/Platzhalter.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: restructure README around Railway 1-click, other hosts, and client setup"
```

---

## Self-Review (gegen das Spec)

**Spec-Coverage (§3 Weg A):**
- §3.1 Railway-Template + auto-gen Secrets → Task 4 Step 1. ✅
- §3.2 `PUBLIC_BASE_URL`-Ableitung → Task 2. ✅
- §3.3 Deploy-Ablauf im Guide → Task 4 Step 3, Abschnitt 3/4. ✅
- §3.4 „Andere Hosts" → Task 3 (Dockerfile) + Task 4 Step 3, Abschnitt 5. ✅
- §5 Client-Einbindung → Task 4 Step 3, Abschnitt 6. ✅
- §6 LICENSE (MIT) → Task 1. ✅
- **Nicht hier (bewusst):** Shared-Core-Refactor + Weg B → Plan 2. DSGVO → separat.

**Placeholder-Scan:** `<TEMPLATE_URL>` / `<deine-domain>` sind bewusste Einsetzstellen für den ausführenden Schritt (Template existiert erst nach Task 4 Step 1), keine offenen Plan-Lücken. Sonst keine TODOs.

**Typ-Konsistenz:** Task 2 lässt `AppConfig` unverändert; keine neuen Signaturen über Tasks hinweg. Konsistent.

**Verifikations-Hinweis (Definition of Done, Spec §8):** Nach Task 2 zusätzlich ein Live-Smoke-Check gegen die **bestehende** Railway-Instanz (healthz 200 + ein `tools/call` mit vorhandenem PAT), um „bestehende Instanz unberührt" zu belegen — beim Deploy des `PUBLIC_BASE_URL`-Fallbacks.
