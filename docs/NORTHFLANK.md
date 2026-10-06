# Deploying Artemis Prime to Northflank

Artemis Prime builds and runs as a **single container**: the Dockerfile compiles the
React frontend and the Express + Discord bot API server, then serves both from one
process. Northflank builds that image from this repo — you only need a Postgres
addon beside the app service.

Railway support is unchanged (`railway.json` / `railway.toml` / `docs/RAILWAY.md`).
The same Dockerfile and start script work on both hosts.

## Quick path (recommended)

1. Connect your GitHub account in Northflank and grant access to
   **`kaosregulator/Artemis-Prime`**.
2. Create a **project** (any region).
3. Add a **PostgreSQL** addon (TLS on is fine; keep it private unless you need
   external DB access).
4. Create a **combined service** from the GitHub repo + branch (`main` or this
   feature branch while testing).
5. Wire secrets and a public HTTP port (details below).
6. Open the generated domain, set Discord OAuth redirect, redeploy if needed.

Optional: import [`../northflank.template.json`](../northflank.template.json) as a
Northflank template (Account → Templates → edit as code) to create the project,
Postgres addon, combined service, and secret group in one run. You still need to
paste Discord credentials and confirm the GitHub repo is linked to your team.

## Combined service settings

| Setting | Value |
| --- | --- |
| Service type | **Combined** (build + deploy from Git) |
| Repository | `https://github.com/kaosregulator/Artemis-Prime` |
| Branch | `main` (or your deploy branch) |
| Build type | **Dockerfile** |
| Dockerfile path | `/artifacts/api-server/Dockerfile` |
| Build context / workdir | `/` (repo root) |
| Start command | Leave default — image `CMD` already runs `start-with-schema.sh` |
| Public port | **HTTP**, internal port **8080** (matches `EXPOSE 8080`) |
| Health check | HTTP `GET /api/healthz` on port **8080** (readiness + liveness) |

Do **not** override the Docker CMD unless you keep the schema push:

```text
sh artifacts/api-server/scripts/start-with-schema.sh
```

That script runs `drizzle-kit push` (non-interactive, no `--force`) then starts
the API + Discord bot worker.

`lib/db/drizzle.config.ts` **whitelists only** Artemis Prime application tables
(from `lib/db/src/applicationTables.ts`). Managed Postgres / extension objects
in `public` (for example `pg_stat_kcache_detail` from Northflank’s monitoring
extensions) are never part of the push diff. Without that whitelist, drizzle-kit
would try to `DROP` those views and fail with
`must be owner of view pg_stat_kcache_detail` because the app DB role does not
own them. Do **not** “fix” that by granting superuser or changing extension
ownership — the application-table whitelist is the intended solution.

Do **not** combine that whitelist with drizzle-kit `extensionsFilters` (PostGIS
negate globs): those negate patterns re-admit unmanaged objects into the push
diff. Boot also fails closed if drizzle-kit still logs an ownership / ERROR line.

## Environment variables

Create a **secret group** of runtime environment variables and apply it to the
combined service. Link the Postgres addon and alias its connection string:

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | alias of addon `POSTGRES_URI` | Required — boot fails without it |
| `SESSION_SECRET` | long random string | `openssl rand -hex 32` |
| `DISCORD_CLIENT_ID` | Discord app client ID | |
| `DISCORD_CLIENT_SECRET` | Discord app client secret | |
| `DISCORD_BOT_TOKEN` | Discord bot token | Bot starts automatically when `NODE_ENV=production` |
| `DISCORD_REDIRECT_URI` | `https://<your-nf-domain>/api/auth/callback` | Set after the public domain exists |
| `PORT` | `8080` | Optional safety pin — the image already defaults to `8080` |

`NODE_ENV=production` is set in the Dockerfile. Optional vars
(`DISCORD_DEV_GUILD_ID`, `LOG_LEVEL`, Roblox / Bloxscout) are documented in
`.env.example`.

### Linking Postgres → `DATABASE_URL`

1. Secret group → **Show addons** → select your PostgreSQL addon.
2. Link `POSTGRES_URI` (or the suggested URI secret).
3. Set alias **`DATABASE_URL`**.
4. Restrict / apply the group to the Artemis Prime combined service.

## Networking & Discord OAuth

1. Confirm the service has a **public HTTP** port on **8080**.
2. Copy the Northflank DNS (e.g. `p01--artemis-prime--….code.run`).
3. Set `DISCORD_REDIRECT_URI` to `https://<that-host>/api/auth/callback`.
4. In the Discord Developer Portal → OAuth2 → Redirects, add the **exact** same URL.
5. Redeploy / restart so the new env vars load.
6. Health: `https://<that-host>/api/healthz` should return `{"status":"ok"}`.

The app already sets `trust proxy` so OAuth works behind Northflank’s TLS
terminator.

## Database schema

Same behavior as Railway:

1. Container start → `start-with-schema.sh` → `drizzle-kit push`
2. Node boot → additive `ensureSchema()` safety net

Watch deploy logs for `Applying database schema` then
`Starting Artemis Prime API server...`.

If logs stop after `Pulling schema from database...` with
`must be owner of view pg_stat_kcache_detail` (or similar extension objects),
confirm you are on a commit that includes the application-table whitelist
(`lib/db/src/applicationTables.ts` + `tablesFilter` in
`lib/db/drizzle.config.ts`) and the fail-closed `push-schema.sh` wrapper.
Redeploy that commit — do not grant the app role superuser privileges.

## Resources

Discord bots + canvas rendering need a bit of headroom. Start around:

- **Deployment plan**: something in the ~0.2–0.5 vCPU / 512MB–1GB range (bump if
  canvas or slash sync feels tight)
- **Build plan**: larger compute for the multi-stage Node/pnpm image build
- **Instances**: **1** (Discord bot must not run as multiple replicas)

## Troubleshooting

- **`must be owner of view pg_stat_kcache_detail`** (or other `pg_stat_*`
  objects) during schema push → unmanaged Northflank extension objects were
  being targeted by an older `drizzle-kit push` config. Deploy a build that
  whitelists only `lib/db/src/applicationTables.ts` via `tablesFilter`. Do not
  change extension ownership or grant superuser to the app role.
- **Crash loop immediately** → missing `DATABASE_URL` or `SESSION_SECRET`.
- **Build fails on Dockerfile path** → confirm path is
  `/artifacts/api-server/Dockerfile` and build context is `/`.
- **Port / connection refused** → public port must target internal **8080**; do
  not change the app to listen on 80 inside the container.
- **Login bounces home** → `DISCORD_REDIRECT_URI` mismatch vs Discord portal, or
  schema push failed (check logs for drizzle-kit).
- **`relation "clan_members" does not exist`** → start command skipped schema
  push. Use the image default CMD / `start-with-schema.sh`.
- **Slash commands Missing Access (50001)** → remove a bad
  `DISCORD_DEV_GUILD_ID`, or re-invite with `bot` + `applications.commands`.

## Keeping Railway

Leave the existing Railway project as-is. Deploy this same branch/repo to
Northflank as a second environment. Use **separate** Postgres databases and
Discord redirect URLs per host (or one primary host only for OAuth). Never point
two live bot processes at the **same** `DISCORD_BOT_TOKEN` — Discord allows only
one gateway session per token.
