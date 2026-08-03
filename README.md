# WHOOP MCP Server

A multi-user [MCP](https://modelcontextprotocol.io) server that exposes WHOOP
fitness data (recovery, sleep, workouts, cycles, profile, body measurements)
to AI clients such as Claude, ChatGPT, and local editors (Cursor, Cline).

Each user connects their own WHOOP account via OAuth and only ever sees their
own data. The server acts as a full OAuth 2.1 authorization server for MCP
clients, delegating identity to WHOOP as the upstream identity provider.

Data is fetched live from the WHOOP API on every tool call — no fitness data
is cached or stored. Postgres only holds user identity and encrypted tokens.

## Two ways to use this

There are two ways to get WHOOP data into your AI client:

- **A. Self-host as a remote connector** (this README) — run your own instance
  (Railway 1-click, Docker, Fly.io, Render, ...) and connect any MCP client to
  it over HTTP, either via OAuth or a personal access token.
- **B. Local Claude Desktop extension** — a packaged extension that runs
  locally without hosting anything yourself. This is coming separately; see
  "Way B" once it's available.

## 1-Click deploy on Railway

<!-- Replace RAILWAY_TEMPLATE_URL_PLACEHOLDER with the published Railway template URL -->
[![Deploy on Railway](https://railway.com/button.svg)](RAILWAY_TEMPLATE_URL_PLACEHOLDER)

1. Click the button above — Railway provisions the app service and a Postgres
   database, and auto-generates `ENCRYPTION_KEY` and `SESSION_SECRET`.
2. Copy your new Railway domain.
3. Create a WHOOP developer app (see **WHOOP app setup** below).
4. Enter `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` as service variables in
   Railway, then redeploy.
5. Connect an AI client (see **Connect an AI client** below).

## WHOOP app setup

1. Register a developer application at the [WHOOP Developer Portal](https://developer.whoop.com/).
2. Set the app's **redirect URI** to:

   ```
   https://<your-domain>/whoop/callback
   ```

3. Request the scopes:

   ```
   read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement offline
   ```

4. Copy the client ID and secret — you'll enter these as `WHOOP_CLIENT_ID` /
   `WHOOP_CLIENT_SECRET`.

## Running on other hosts

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `ENCRYPTION_KEY` | 32-byte hex key used to encrypt stored WHOOP tokens at rest. Generate with `openssl rand -hex 32`. |
| `WHOOP_CLIENT_ID` | Client ID from your WHOOP developer app. |
| `WHOOP_CLIENT_SECRET` | Client secret from your WHOOP developer app. |
| `PUBLIC_BASE_URL` | The publicly reachable base URL of this deployment, e.g. `https://your-app.example.com` (no trailing slash). Used to build OAuth redirect/callback URLs. On Railway this is derived automatically from `RAILWAY_PUBLIC_DOMAIN` when not set explicitly; on other hosts you must set it explicitly. |
| `SESSION_SECRET` | Secret used to sign the dashboard's session cookie. Generate with `openssl rand -hex 32`. |
| `PORT` | Port to listen on. Defaults to `8080`. |

### Docker / your own VPS

```bash
docker build -t whoop-mcp . && docker run -p 8080:8080 --env-file .env whoop-mcp
```

Set `PUBLIC_BASE_URL` explicitly in your `.env` — there's no
`RAILWAY_PUBLIC_DOMAIN` to fall back on outside Railway.

### Fly.io

`fly launch` uses the repo's Dockerfile. Set secrets via
`fly secrets set KEY=value ...`, and provision Postgres via `fly postgres create`.

### Render

Create a Web Service from this repo using the Docker environment, add a
Postgres add-on, and set the env vars from the table above in the Render
dashboard.

## Connect an AI client

### Browser (Claude.ai / ChatGPT)

1. Add a remote MCP connector pointing at:

   ```
   https://<your-domain>/mcp
   ```

2. The client discovers the OAuth endpoints automatically, redirects you
   through "Connect WHOOP", and starts calling tools (e.g.
   `get_daily_summary`) under your own WHOOP identity.

### Claude Desktop (remote)

Add a custom connector with the same URL, `https://<your-domain>/mcp`, and
go through the same "Connect WHOOP" OAuth flow.

### Optional: local clients via personal access token

1. Open the dashboard at `https://<your-domain>/dashboard` and click
   **Connect WHOOP**.
2. Once connected, click **Create personal access token** and copy the token
   (it is only shown once).
3. Configure your client's `mcp.json` to call `https://<your-domain>/mcp`
   with the token as a bearer header, for example:

```json
{
  "mcpServers": {
    "whoop": {
      "url": "https://<your-domain>/mcp",
      "headers": {
        "Authorization": "Bearer <PAT>"
      }
    }
  }
}
```

Revoke a token at any time from the dashboard, or delete your account
entirely (removes your WHOOP connection and all issued tokens).

## Running locally (development)

1. Set up a local Postgres database and configure `DATABASE_URL`.
2. Run the setup commands:

```bash
npm install
npm run db:migrate
npm run dev
```

The server will start at `http://localhost:8080`. Check health with `GET /healthz`, which returns `{"ok":true}` once running.
