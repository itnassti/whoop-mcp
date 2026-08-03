# Distribution & Open Source — Design-Dokument

**Datum:** 2026-08-03
**Status:** Brainstorming abgeschlossen, wartet auf User-Review → Implementation-Plan
**Kontext:** Der WHOOP-MCP soll über den bestehenden Railway-Server hinaus anderen zugänglich gemacht werden. Zwei Zielgruppen, ein technischer Kern. Keine Neu-Architektur des bestehenden Servers.

## 1. Ziel & Umfang

Zwei Vertriebswege ermöglichen:

1. **Freundeskreis** — läuft weiter über die *bestehende* Instanz des Autors. Multi-User ist bereits implementiert; nichts Neues zu bauen. (Nur nicht-technische Klarstellungen, siehe §7.)
2. **Open Source** — andere hosten sich **selbst** (nicht über den Autor). Pro Instanz typischerweise **ein** Nutzer („Single-User"), aber der Code muss dafür nicht geändert werden.

Für die Open-Source-Zielgruppe gibt es **zwei Einstiegspunkte** ("zwei Türen, ein Haus"), die sich einen gemeinsamen Kern teilen:

- **Weg A — Remote / Self-Host (gehostet):** eigener Server (Railway 1-Click oder anderer Host). Funktioniert mit **Browser-Clients (Claude.ai/ChatGPT)** *und* Claude Desktop. Kostet den Nutzer eine kleine laufende Rechnung.
- **Weg B — Lokale Claude-Desktop-Extension (`.mcpb`):** kostenlos, kein Account, kein laufender Server. Funktioniert **nur in Claude Desktop** (kein Browser).

**Nicht in Scope (bewusst später):** DSGVO-/Datenschutz-Seite für den gehosteten Freundes-Server (eigenes Thema). Preis-/SaaS-Betrieb für beliebige Fremdnutzer. Custom-URI-Scheme-Login (`whoop://`).

## 2. Architektur-Grundentscheidung: kein Umbau des Servers

Zentrale Erkenntnis aus dem Brainstorming: Für **Remote-Connector** verbinden sich Claude.ai/ChatGPT **per OAuth**, also *muss* der Server ein OAuth-Authorization-Server sein. Der bestehende Server ([src/auth/oauth-provider.ts](../../../src/auth/oauth-provider.ts) + [src/app.ts](../../../src/app.ts)) ist damit für Weg A **genau richtig** und bleibt unverändert. „Single-User" heißt nur: pro Instanz meldet sich typischerweise eine Person an — keine Code-Änderung nötig.

Der einzige Eingriff in bestehenden Code ist ein **verhaltenserhaltender Refactor**: WHOOP-Client + Tools in einen geteilten Kern ziehen, den beide Einstiegspunkte (HTTP-Server + stdio-Extension) nutzen.

```
Geteilter Kern (unverändertes Verhalten):
  src/whoop/*        WHOOP-Client, OAuth-Token-Refresh, Typen
  src/mcp/tools.ts   die 7 Read-only-Tools + Registrierung

Weg A (bestehend):  src/app.ts (Express) + OAuth-Server + Postgres  ──┐
                                                                       ├── nutzen denselben Kern
Weg B (neu):        stdio-Entrypoint + lokaler Single-User-Token   ──┘
```

## 3. Weg A — Remote / Self-Host

### 3.1 Railway 1-Click-Template
- `Deploy on Railway`-Button (Template-URL) im README.
- Template provisioniert **Postgres automatisch** (`DATABASE_URL` als Referenz `${{Postgres.DATABASE_URL}}`).
- **Secrets werden beim Deploy auto-generiert** (verifiziert, Railway-Template-Funktionen):
  - `ENCRYPTION_KEY = ${{ secret(64, "abcdef0123456789") }}` — 32-Byte-Hex, äquivalent zu `openssl rand -hex 32`.
  - `SESSION_SECRET = ${{ secret(64, "abcdef0123456789") }}`.
- Der Nutzer füllt im Deploy-Formular **nur** `WHOOP_CLIENT_ID` + `WHOOP_CLIENT_SECRET` aus.

### 3.2 Code-Anpassung: `PUBLIC_BASE_URL` ableiten
- In [src/config.ts](../../../src/config.ts): wenn `PUBLIC_BASE_URL` nicht gesetzt ist, ableiten aus Railways `RAILWAY_PUBLIC_DOMAIN` → `https://${RAILWAY_PUBLIC_DOMAIN}`.
- Nur **Fallback** — eine explizit gesetzte `PUBLIC_BASE_URL` gewinnt weiterhin. **Bestehende Instanz unberührt** (setzt die Variable explizit).
- Entschärft das Henne-Ei-Problem: Nutzer kennt die URL erst nach dem ersten Deploy.

### 3.3 Deploy-Ablauf (Guide)
1. `Deploy on Railway` klicken → App + Postgres provisioniert, Secrets auto-generiert.
2. Railway vergibt eine Domain → Nutzer kopiert sie.
3. Im WHOOP-Portal eine App anlegen mit Redirect-URI `https://<domain>/whoop/callback` + Scopes (`read:recovery`, `read:sleep`, `read:workout`, `read:cycles`, `read:profile`, `read:body_measurement`, `offline`).
4. `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` in Railway eintragen → Redeploy.
5. Connector im Client einbinden (§5).

### 3.4 „Andere Hosts"-Abschnitt (Guide)
Kurzliste, dass der Server ein normales Node-Projekt ist und überall läuft, mit den nötigen Env-Vars aus [.env.example](../../../.env.example):
- **Fly.io**, **Render**, **eigener VPS via Docker/Docker-Compose**.
- Ein minimales `Dockerfile` + Hinweis auf die Pflicht-Env-Vars. (Kein eigenes Deployment-Tooling pro Host — nur dokumentieren.)

## 4. Weg B — Lokale Claude-Desktop-Extension (`.mcpb`)

Neuer, leichter Codepfad — **kein Express, kein OAuth-Server, kein Postgres**.

### 4.1 Bestandteile
- **stdio-Entrypoint:** startet einen MCP-Server über stdio, registriert dieselben Tools aus dem geteilten Kern.
- **Single-User-Token-Store:** genau ein WHOOP-Token.
  - **Config-Inputs** (Client-ID, Client-Secret) kommen über die `.mcpb`-`user_config` mit `"sensitive": true` → **OS-Keychain** (verifiziert: macOS Keychain / Windows Credential Manager).
  - **Zur Laufzeit erworbene Access-/Refresh-Token** (nicht vom Nutzer eingegeben) werden in einer lokalen Datei im Config-Verzeichnis der Extension abgelegt, **verschlüsselt mit dem bestehenden AES-256-GCM** aus [src/crypto.ts](../../../src/crypto.ts); der `ENCRYPTION_KEY` dafür liegt ebenfalls im OS-Keychain (einmalig generiert). So bleibt die Verschlüsselungslogik identisch zum Server.
- **`.mcpb`-Bundle:** ZIP mit `manifest.json` (beschreibt Server + `user_config`-Felder, die Claude Desktop als Config-Dialog rendert) + gebündeltem Node-Code. Doppelklick-Installation, kein JSON-Editieren.

### 4.2 WHOOP-Login (wichtige Design-Entscheidung)
**Verifiziert:** WHOOP erlaubt als Redirect-URI **nur `https://…` oder `whoop://…`**, **kein `http://localhost`**. Der naheliegende Loopback-Login (temporärer localhost-Server) funktioniert daher **nicht**.

**Gewählte Lösung — statische https-Callback-Seite + manuelles Code-Einfügen:**
1. Als Teil des OSS-Repos wird eine **statische Seite auf GitHub Pages** gehostet, z.B. `https://<user>.github.io/whoop-mcp/callback`. Sie enthält **keinen Secret und keinen Server** — sie liest nur `?code=…` aus der URL und zeigt den Code zum Kopieren an.
2. Der Nutzer registriert **diese** URL als Redirect-URI in seiner WHOOP-App.
3. Der Login läuft **innerhalb von Claude Desktop über zwei MCP-Tools** (kein separates CLI nötig): `whoop_login` gibt die fertige WHOOP-Authorize-URL + Anleitung zurück (der Nutzer öffnet sie im Browser); `whoop_complete_login` nimmt den von der statischen Seite kopierten `code` entgegen. Solange kein Token vorhanden ist, antworten die Daten-Tools mit einem Hinweis, zuerst `whoop_login` auszuführen.
4. Die Extension tauscht den Code **lokal** (mit dem lokal gehaltenen Client-Secret) gegen Access-/Refresh-Token und speichert sie. Token-Refresh danach wie im bestehenden [src/whoop/oauth.ts](../../../src/whoop/oauth.ts).

Bekanntes „paste-the-code"-Muster; funktioniert für alle Nutzer, https-konform, ohne zentralen Server. `whoop://`-Custom-Scheme wäre eine spätere Verfeinerung (cross-platform fragil, daher jetzt nicht).

## 5. Client-Einbindung (Guide, beide Wege)

- **Browser (Claude.ai / ChatGPT):** Remote-Connector hinzufügen, `https://<host>/mcp` eingeben → Client entdeckt OAuth automatisch → „Connect WHOOP" durchklicken. (Nur Weg A.)
- **Claude Desktop, Weg A:** denselben Remote-Connector-URL eintragen.
- **Claude Desktop, Weg B:** `.mcpb` doppelklicken → Creds im Dialog → `login` → Code einfügen. Einbindung automatisch.

## 6. Lizenz & Repo-Hygiene

- **LICENSE:** MIT (maximal freizügig) im Repo-Root.
- README/Guide restrukturieren entlang der realen Abläufe oben (Deploy → WHOOP-App → Einbindung), je ein kurzer Abschnitt pro Client. Der bestehende ConnectionGuide im Dashboard liefert Bausteine.

## 7. Freundeskreis (Fall 1) — nur Klarstellungen

Nichts Neues zu bauen; dieselbe bestehende Instanz, der Autor lädt Einzelne ein. Zu beachten (nicht Teil dieses Specs, aber notiert):
- **WHOOP-User-Limit** einer Dev-App (Größenordnung ~10) — für einen kleinen Kreis ausreichend.
- **DSGVO** wird bewusst separat/später behandelt.
- Offene Security-Follow-ups aus dem letzten Review (teils erledigt) werden relevanter, sobald echte Fremddaten über den Server laufen.

## 8. Verifikation (Definition of Done)

- **Refactor verhaltenserhaltend:** bestehende Test-Suite vor **und** nach dem Refactor grün; anschließend Live-Smoke-Check gegen die Railway-Instanz (healthz 200 + ein echter `tools/call` mit bestehendem PAT).
- **Weg A:** Frische Railway-Deploy-Instanz aus dem Template hochziehen, WHOOP-App verbinden, ein Tool-Call über einen Remote-Connector erfolgreich.
- **Weg B:** `.mcpb` in Claude Desktop installieren, Login via statische Seite abschließen, ein Tool-Call erfolgreich.

## 9. Offene Punkte / Risiken

- **WHOOP Production-Review-Schwelle** (ab wann eine Dev-App reviewt werden muss) noch nicht abschließend geklärt — betrifft primär den gehosteten Freundes-Server, nicht die Self-Host-Instanzen einzelner Nutzer.
- **GitHub-Pages-Callback-Seite** ist eine kleine zusätzliche Infrastruktur (statisch, wartungsarm) — Teil des OSS-Repos.
- **Weg B ist echter Neu-Code** (stdio + Token-Store + Bundle + Login-Flow); der aufwändigste Teil des Specs. Weg A ist überwiegend Packaging + Doku.
