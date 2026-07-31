# WHOOP MCP Server

A multi-user [MCP](https://modelcontextprotocol.io) server that exposes WHOOP
fitness data (recovery, sleep, workouts, cycles, profile, body measurements)
to AI clients such as Claude, ChatGPT, and local editors (Cursor, Cline).

Each user connects their own WHOOP account via OAuth and only ever sees their
own data. The server acts as a full OAuth 2.1 authorization server for MCP
clients, delegating identity to WHOOP as the upstream identity provider.

Data is fetched live from the WHOOP API on every tool call — no fitness data
is cached or stored. Postgres only holds user identity and encrypted tokens.

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string (Railway provisions this automatically when you attach a Postgres plugin). |
| `ENCRYPTION_KEY` | 32-byte hex key used to encrypt stored WHOOP tokens at rest. Generate with `openssl rand -hex 32`. |
| `WHOOP_CLIENT_ID` | Client ID from your WHOOP developer app. |
| `WHOOP_CLIENT_SECRET` | Client secret from your WHOOP developer app. |
| `PUBLIC_BASE_URL` | The publicly reachable base URL of this deployment, e.g. `https://your-app.up.railway.app` (no trailing slash). Used to build OAuth redirect/callback URLs. |
| `SESSION_SECRET` | Secret used to sign the dashboard's session cookie. Generate with `openssl rand -hex 32`. |
| `PORT` | Port to listen on. Defaults to `8080`; Railway sets this automatically. |

## WHOOP developer app setup

1. Register a developer application at the [WHOOP Developer Portal](https://developer.whoop.com/).
2. Set the app's **redirect URI** to:

   ```
   ${PUBLIC_BASE_URL}/whoop/callback
   ```

   For example: `https://your-app.up.railway.app/whoop/callback`.
3. Request the scopes: `read:recovery`, `read:sleep`, `read:workout`,
   `read:cycles`, `read:profile`, `read:body_measurement`, `offline`.
4. Copy the client ID and secret into `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET`.

## Running locally

```bash
npm install
npm run db:migrate
npm run dev
```

`GET /healthz` should return `{"ok":true}` once the server is up.

## Deploying to Railway

This repo includes a `railway.json` (Nixpacks builder). On deploy, Railway
builds the project (`npm run build`) and then runs:

```
npm run db:migrate && npm start
```

Steps:

1. Create a Railway project and attach a Postgres plugin (sets `DATABASE_URL`).
2. Set the remaining environment variables from the table above.
3. Deploy. Confirm `GET /healthz` and
   `GET /.well-known/oauth-authorization-server` respond once live.
4. Update your WHOOP developer app's redirect URI to match the deployed
   `PUBLIC_BASE_URL`.

## Connecting clients

### Claude / ChatGPT (remote connector, OAuth)

Add a remote MCP connector pointing at:

```
${PUBLIC_BASE_URL}/mcp
```

The client will discover the OAuth endpoints automatically, redirect you
through "Connect WHOOP", and start calling tools (e.g. `get_daily_summary`)
under your own WHOOP identity.

### Local clients (Cursor, Cline, etc.) via personal access token

1. Open the dashboard at `${PUBLIC_BASE_URL}/dashboard` and click **Connect WHOOP**.
2. Once connected, click **Create personal access token** and copy the token
   (it is only shown once).
3. Configure your client's `mcp.json` to call `${PUBLIC_BASE_URL}/mcp` with
   the token as a bearer header, for example:

```json
{
  "mcpServers": {
    "whoop": {
      "url": "https://your-app.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <PAT>"
      }
    }
  }
}
```

Revoke a token at any time from the dashboard, or delete your account
entirely (removes your WHOOP connection and all issued tokens).
