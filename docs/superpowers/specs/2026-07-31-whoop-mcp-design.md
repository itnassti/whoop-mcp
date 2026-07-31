# WHOOP-MCP — Design-Dokument

**Datum:** 2026-07-31
**Status:** Genehmigt (Brainstorming), bereit für Implementation-Plan
**Autor:** Christian Axtmann (+ Claude)

## 1. Ziel & Kontext

Ein Multi-User **MCP-Server**, der WHOOP-Fitnessdaten (Recovery, Sleep, Workouts,
Cycles, Profil, Körpermaße) in beliebigen KI-Clients verfügbar macht. Das Produkt
soll **anderen Nutzern angeboten** werden können: jeder verbindet seinen eigenen
WHOOP-Account, sieht aber nur seine eigenen Daten.

Gehostet auf **Railway**, Stack **TypeScript / Node**, Datenhaltung **Postgres**
(nur Identität + Tokens, keine Fitnessdaten).

### Zielgruppen-Clients
- Claude (Web/Desktop) — Remote-MCP mit OAuth 2.1
- ChatGPT (Connectors) — Remote-MCP mit OAuth 2.1
- Lokale Clients (Cursor, Cline, `mcp.json`) — Bearer-Token / PAT

## 2. Kern-Entscheidungen (mit Begründung)

| # | Entscheidung | Begründung | Später-Pfad |
|---|---|---|---|
| 1 | **Eine zentrale WHOOP-App** (SaaS), nicht App-pro-User | Minimale Onboarding-Reibung; User klickt nur "Connect WHOOP", muss nie ins Developer Portal | `CredentialProvider`-Interface erlaubt später User-eigene Apps ohne Umbau der Consumer |
| 2 | **Live-on-demand**, kein Fitnessdaten-Cache | WHOOP-Daten ändern sich real ~1x/Tag; bei wenigen Usern locker unter Rate-Limit; radikal einfacher MVP | Postgres-Cache-Schicht + Webhooks + Sync-Cron später hinter `whoop-client` andockbar |
| 3 | **Voller OAuth-2.1-Server** von Anfang an, mit WHOOP als Upstream-IdP | Claude & ChatGPT brauchen OAuth-Discovery; Ein-Klick-UX für alle Zielgruppen sofort | — |
| 4 | **Alle drei Client-Typen** unterstützen | Explizite Anforderung | — |
| 5 | **TypeScript/Node** | Offizielles MCP-SDK am ausgereiftesten, bestes OAuth-Ökosystem, läuft nativ auf Railway | — |

## 3. Architektur

Ein einzelner Railway-Service (Node/TS-Prozess) mit drei Verantwortlichkeiten:

```
┌──────────────────────── Railway Service (Node/TS) ────────────────────────┐
│                                                                            │
│  A) OAuth 2.1 Authorization Server   B) MCP Server (Streamable HTTP)       │
│     /.well-known/*                      /mcp   ← Tool-Calls                 │
│     /authorize  /token  /register       (Bearer-Token → User)              │
│         │                                                                   │
│         └─ delegiert Identität an ─┐    C) Mini-Dashboard (HTML)            │
│                                    │       /  "Connect WHOOP" + PAT-Ausgabe │
│                                    ▼                                        │
│                            WHOOP OAuth (Upstream IdP)                       │
│                                                                            │
│  Postgres (Railway): users, whoop_tokens (verschlüsselt), mcp_tokens/PATs  │
└────────────────────────────────────────────────────────────────────────────┘
                    │ Live-Calls (on demand)
                    ▼
            WHOOP API v2  (api.prod.whoop.com)
```

## 4. Komponenten

Jede Einheit hat einen klaren Zweck, kommuniziert über definierte Interfaces und ist
isoliert testbar.

| Modul | Aufgabe | Abhängigkeiten |
|---|---|---|
| `whoop-client` | Typisierte Wrapper um WHOOP-API v2; Auto-Refresh bei 401; Rate-Limit-Handling (429 + Backoff-Retry) | `fetch`, `token-store`, `credential-provider` |
| `token-store` | CRUD für WHOOP-Refresh-Tokens, **AES-256-GCM verschlüsselt at-rest**; Refresh-Logik | Postgres (`db`) |
| `oauth-server` | OAuth-2.1-AS: Discovery-Metadaten, `/authorize`, `/token`, Dynamic Client Registration; delegiert Identität an WHOOP | `token-store`, OAuth-Library |
| `mcp-server` | Definiert MCP-Tools; mappt Bearer-Token → User; ruft `whoop-client` | `oauth-server`, `whoop-client` |
| `dashboard` | Eine HTML-Seite: WHOOP verbinden, PAT erzeugen/widerrufen, Account löschen | `oauth-server`, `token-store` |
| `credential-provider` | Interface, das WHOOP-Client-ID/Secret liefert. MVP-Impl: `EnvCredentialProvider` (eine zentrale App) | Env |
| `db` | Schema + Migrationen (Drizzle) | Postgres |

### `CredentialProvider`-Interface (Erweiterbarkeit)

```ts
interface CredentialProvider {
  // Liefert die WHOOP-OAuth-Credentials für einen (künftig ggf. user-spezifischen) Kontext
  getClientCredentials(userId?: string): Promise<{ clientId: string; clientSecret: string }>;
}
```
MVP: gibt immer die zentralen Env-Credentials zurück. Später: User-eigene App-Credentials
aus der DB.

## 5. MCP-Tools (read-only, Live)

Task-orientiert statt roher 1:1-API-Dumps — angenehmer für die KI. Alle Tools mit
optionalen Datumsfiltern; Pagination gekapselt (Tool aggregiert Seiten intern).

| Tool | Beschreibung |
|---|---|
| `get_recovery` | Neueste oder Zeitraum: Score, HRV, RHR, SpO2, Hauttemperatur |
| `get_sleep` | Neueste oder Zeitraum: Stages, Performance, Atemfrequenz, Schlaf-Konsistenz |
| `get_workouts` | Zeitraum: Strain, HR-Zonen, Distanz, Höhenmeter |
| `get_cycles` | Zeitraum: Tages-Strain, Energie |
| `get_profile` | Name, Email |
| `get_body_measurement` | Größe, Gewicht, Max-HR |
| `get_daily_summary` | Convenience: Recovery + Sleep + Strain für einen Tag kombiniert (spart Round-Trips) |

Benötigte WHOOP-Scopes: `read:recovery`, `read:sleep`, `read:workout`, `read:cycles`,
`read:profile`, `read:body_measurement`, `offline` (Refresh-Token).

Zugrundeliegende WHOOP-v2-Endpoints: `/v2/recovery`, `/v2/activity/sleep`,
`/v2/activity/workout`, `/v2/cycle`, `/v2/user/profile/basic`,
`/v2/user/measurement/body`.

## 6. Auth-Flow

### Remote (Claude / ChatGPT)
1. Client entdeckt OAuth via `/.well-known/oauth-authorization-server`.
2. Client → `/authorize` des Servers.
3. Server redirectet zum **WHOOP-OAuth-Consent** ("App XY darf Recovery/Sleep/… lesen").
4. User autorisiert → WHOOP redirectet zurück mit Code.
5. Server tauscht Code gegen WHOOP-Tokens, speichert Refresh-Token **verschlüsselt**,
   mintet eigenen **MCP-Access-Token**, gebunden an WHOOP-`user_id`.
6. Client nutzt MCP-Token als `Authorization: Bearer` bei `/mcp`.

### Lokal (Cursor / Cline)
1. User öffnet Dashboard (`/`) → "Connect WHOOP" (gleicher Upstream-Flow wie oben).
2. Erhält einen **Personal Access Token (PAT)**.
3. Trägt ihn als `Authorization: Bearer <PAT>` in seine `mcp.json` ein.

Beide Pfade resolven zu **einem** User-Record mit **einem** WHOOP-Refresh-Token.

## 7. Datenmodell (Postgres)

```
users            (id PK, whoop_user_id UNIQUE, email, created_at)
whoop_tokens     (user_id FK, refresh_token_encrypted, access_token_encrypted,
                  access_token_expires_at, scopes, updated_at)
mcp_tokens       (token_hash PK, user_id FK, type: 'oauth'|'pat', label,
                  created_at, last_used_at, revoked_at NULL)
oauth_clients    (client_id PK, redirect_uris, created_at)   -- Dynamic Client Registration
oauth_auth_codes (code_hash PK, client_id, user_id, expires_at, pkce_challenge)
```
Tokens werden nur als **Hash** gespeichert (Lookup), Secrets nie im Klartext.

## 8. Fehler & Resilienz

- **401 von WHOOP** → automatischer Refresh, dann Retry; scheitert der Refresh →
  klare MCP-Fehlermeldung "bitte WHOOP neu verbinden" mit Dashboard-Link.
- **429 Rate-Limit** → `X-RateLimit-Reset` respektieren, ein Retry mit Backoff, sonst
  freundlicher Hinweis an die KI.
- **User hat WHOOP nicht verbunden** → Tool gibt umsetzbaren Dashboard-Link zurück.
- Tokens **niemals** in Logs.

## 9. Sicherheit & DSGVO

Bei zentraler App ist der Betreiber **Verarbeiter von Gesundheitsdaten** →

- Refresh-Tokens **AES-256-GCM verschlüsselt at-rest**; Master-Key aus Railway-Env
  (`ENCRYPTION_KEY`), nicht in der DB.
- Minimale OAuth-Scopes — nur was die Tools brauchen.
- Dashboard-`/delete`: löscht Tokens + User ("Recht auf Vergessen").
- **Risiko / To-do vor öffentlichem Launch (kein Code):** Datenschutzerklärung,
  ggf. AVV, WHOOP-Production-Freigabe (App startet im Entwicklermodus mit begrenzter
  User-Zahl; Production-Review nötig für viele Nutzer).

## 10. Tests

- **Unit:** `token-store` (Verschlüsselung, Refresh-Logik), `whoop-client`
  (401→Refresh→Retry, 429→Backoff) gegen gemockte WHOOP-API.
- **Integration:** OAuth-Flow end-to-end gegen WHOOP-Mock; ein MCP-Tool-Call mit
  Test-Token gegen `/mcp`.
- **Kein** Live-WHOOP-Account in CI — WHOOP-API wird durchgängig gemockt.

## 11. Bewusst ausgeklammert (YAGNI, später andockbar)

- Postgres-Caching der Fitnessdaten
- WHOOP-Webhooks (`sleep/workout/recovery` `.updated`/`.deleted`)
- Sync-/Reconciliation-Cron
- Multi-App-Support (User-eigene WHOOP-Apps) — Interface aber vorbereitet
- Billing / Abrechnung
- Weitergehende Dashboard-UI

## 12. Offene Punkte zur Verifikation während Implementation

- Exakte WHOOP-Access-Token-Lebensdauer & Refresh-Token-Rotation (Doku unspezifisch).
- WHOOP-Production-Freigabe-Prozess & Test-User-Limit im Entwicklermodus.
- Welche OAuth-Library die MCP-2.1-AS-Rolle am saubersten abdeckt (Evaluierung im Plan).
