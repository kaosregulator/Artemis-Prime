# Artemis Prime

A **Discord-first daily activity & XP tracker** designed for gaming clans and communities. Officers verify progress in-game and update the bot; members never submit. Built with TypeScript, React, Express, and PostgreSQL.

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Status](https://img.shields.io/badge/Status-Active-brightgreen)

## Features

- **Discord-Native Interface**: Slash commands, interactive panels, modals — no web browser needed
- **Officer-Managed XP**: Officers verify progress in-game and update the bot; members never submit
- **Live Command Center**: One persistent `/panel` message that survives restarts and auto-refreshes as data changes, with navigation into every hub
- **Weekly Progress Engine**: Exact / complete / custom tracking modes, per-member goal overrides, exempt & on-leave flags
- **Daily XP Ledger & Calendar**: Per-day entries (with backfill) roll up into week/month/all-time and a rendered calendar
- **Reminders & Enforcement**: Friendly nudges, threshold-based warnings, escalation flags — with anti-double-ping guards
- **Notification Center**: Staff attention feed with read / clear / resolve and auto-resolution
- **Disputes & Tickets**: Members contest their own warnings; staff review and track issues to resolution
- **Staff Notes**: Append-only, author-stamped notes with optional member DM delivery
- **Guided Setup Wizard**: Linear, validated 10-step configuration (plus an advanced hub)
- **Full Audit Trail**: Every action logged; `/xp audit` shows before → after history
- **Fully Configurable & Multi-Game**: Roblox by default, works with any game/community
- **Canvas Rendering**: Branded card designs with bundled OFL fonts

## Quick Start

### Prerequisites

- **Node.js** 24+ and **pnpm**
- **PostgreSQL** database
- **Discord Bot** (create one at [Discord Developer Portal](https://discord.com/developers/applications))

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/kaosregulator/Artemis-Prime.git
   cd Artemis-Prime
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Required variables:
   - `DATABASE_URL` — PostgreSQL connection string
   - `SESSION_SECRET` — Express session secret (generate with `openssl rand -hex 32`)
   - `DISCORD_BOT_TOKEN` — Your Discord bot token
   - `DISCORD_CLIENT_ID` — Discord application client ID
   - `DISCORD_CLIENT_SECRET` — Discord application client secret

4. **Push database schema**
   ```bash
   pnpm --filter @workspace/db run push
   ```

5. **Start development servers**
   ```bash
   # Terminal 1: API Server (runs on port 5000)
   pnpm --filter @workspace/api-server run dev

   # Terminal 2: React Frontend (runs on port 5173)
   pnpm --filter @workspace/clan-xp-tracker run dev
   ```

6. **Add the bot to your Discord server**
   - Go to Discord Developer Portal → OAuth2 → URL Generator
   - Select scopes: `bot` + `applications.commands`
   - Select permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Add Reactions`
   - Visit the generated URL and authorize

7. **Run the `/setup` command** in your Discord server to configure the bot

## Commands

This is an **officer-managed** XP system: members never submit XP — officers
verify progress in-game and update the bot. Everything runs through slash
commands and interactive panels.

### Member Commands
- `/xp progress [@member]` — Where you stand this week (self, or any member for officers)
- `/calendar [@member] [month]` — Your daily XP calendar
- `/xp history [@member]` — Your archived weekly outcomes
- `/xp audit [@member]` — Full history / audit trail (before → after, who, when)
- `/warnings [@member]` — Your active XP warnings
- `/dispute` — Contest one of your own warnings (ownership enforced)

### Officer Commands
- `/panel` — Post the **persistent live command center** (survives restarts, auto-refreshes)
- `/xp set | add | remove | complete | reset @user` — Update a member's weekly progress
- `/entry @user <amount> [date]` — Log daily XP (rolls up; backfills past days)
- `/xp goal | exempt | leave | note @user` — Per-member settings (`note` can DM the member)
- `/xp role add | reset | remind | warn | entry | track` — Bulk actions on a role
- `/remind @user` · `/warn @user` — Nudge or warn (warn is admin-gated)
- `/missing [role]` — Who hasn't hit today's target
- `/xp review` — Weekly card: bulk remind / warn / export / reset
- `/xp dashboard` — Filterable roster of who needs attention
- `/notifications` — Staff notification center (read / clear / resolve)
- `/disputes` — Review member warning disputes
- `/tickets` — Track staff issues to resolution
- `/help` — In-app guide
- `/link` — Link a Roblox avatar to a Discord member (role walkthrough; shows Discord nickname + username for Bloxlink-style matching)
- `/viewlink @user` — Private player dashboard (warnings + activity)

### Admin Commands
- `/setup` — Guided setup wizard (new servers) or the advanced config hub

## Project Structure

```
Artemis-Prime/
├── artifacts/
│   ├── api-server/           # Express API + Discord Bot
│   │   ├── src/
│   │   │   ├── bot/          # Discord.js bot & commands
│   │   │   │   ├── canvas/   # Card rendering engine
│   │   │   │   ├── features/ # Feature workflows
│   │   │   │   ├── services/ # DB & domain logic
│   │   │   │   └── ui/       # Component builders & customId registry
│   │   │   └── routes/       # API endpoints
│   │   └── build.mjs         # esbuild config
│   └── clan-xp-tracker/      # React + Vite frontend
│       └── src/
│           ├── pages/        # Landing, guilds, dashboard
│           └── components/   # React components
├── lib/
│   ├── api-spec/             # OpenAPI specification
│   ├── api-zod/              # Zod validation schemas (auto-generated)
│   ├── api-client-react/     # React Query hooks (auto-generated)
│   └── db/                   # Drizzle ORM schema
├── scripts/                  # Build & utility scripts
├── docs/                     # Documentation (Railway + Northflank)
├── railway.json              # Railway deploy config
├── railway.toml              # Railway deploy config
├── northflank.template.json  # Optional Northflank IaC template
└── pnpm-workspace.yaml       # Workspace configuration
```

## Development

### Build Commands

```bash
# Typecheck all packages
pnpm run typecheck

# Build all packages
pnpm run build

# Regenerate API hooks & schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Push database schema changes (dev only)
pnpm --filter @workspace/db run push
```

### Architecture Overview

- **Auth**: Discord OAuth2 + express-session (PostgreSQL-backed)
- **Database**: PostgreSQL + Drizzle ORM with full schema tracking
- **API**: Express 5 with Zod validation
- **Bot**: discord.js v14 with slash commands
- **Frontend**: React + Vite + Tailwind CSS
- **API Codegen**: Orval (generates from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- **Rendering**: Native canvas with bundled OFL fonts (Outfit, JetBrains Mono)

### Key Files

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/` — Database tables and relationships
- `artifacts/api-server/src/bot/commands.ts` — Command definitions
- `artifacts/api-server/src/bot/canvas/` — Card design templates
- `artifacts/clan-xp-tracker/src/pages/` — Web dashboard pages

## Configuration

All configuration is server-specific and managed via the `/setup` command —
a guided 10-step wizard for new servers, or an advanced hub for quick edits:

- **Community & activity** — Clan name, what you track (XP/Activities/…), game
- **Tracking mode** — Exact progress, complete/not-complete, or a custom goal
- **Weekly goal & daily target** — The weekly requirement and optional per-day target
- **Schedule** — Timezone, week start day + reset time, reminder days/time
- **Roles** — Officer, admin, exempt and on-leave roles
- **Channels** — Reminder, warning and log channels
- **Enforcement** — Warn-after-N-reminders and escalation thresholds, warning role
- **Notifications & automation** — DM/ping reminders, auto weekly reset, history archiving

## Deployment

One Docker image runs the API, static web UI, and Discord bot worker. Schema push
happens automatically on container start.

### Northflank

Full guide: **[`docs/NORTHFLANK.md`](./docs/NORTHFLANK.md)**

Short version:

1. Connect GitHub → create a project → add a **PostgreSQL** addon
2. Create a **combined service** from this repo
3. Dockerfile path: `/artifacts/api-server/Dockerfile`, build context `/`
4. Public HTTP port **8080**, health check `GET /api/healthz`
5. Secret group: `DATABASE_URL` (alias of addon `POSTGRES_URI`), `SESSION_SECRET`, Discord vars
6. Set `DISCORD_REDIRECT_URI` to `https://<your-nf-domain>/api/auth/callback`

Optional: import [`northflank.template.json`](./northflank.template.json) as a Northflank template.

### Railway

Full guide: **[`docs/RAILWAY.md`](./docs/RAILWAY.md)**

The repo includes `railway.json` and `railway.toml` for one-click Railway deployment.
Railway and Northflank can both stay configured — use **separate** databases and do
**not** run two live processes on the same `DISCORD_BOT_TOKEN`.

### Self-Hosted

Provide:
- PostgreSQL database
- Node.js 24+ with pnpm (or run the Dockerfile)
- Discord bot token

```bash
docker build -f artifacts/api-server/Dockerfile -t artemis-prime .
docker run --env-file .env -p 8080:8080 artemis-prime
```

## Testing & Validation

```bash
# Full workspace typecheck
pnpm run typecheck

# Typecheck specific package
pnpm --filter @workspace/api-server run typecheck

# Watch mode (development)
pnpm --filter @workspace/api-server run dev
```

All packages are strict TypeScript (`noUncheckedIndexedAccess`, `noImplicitAny`, etc).

## Important Notes

- **Database Push Required**: After pulling locally, run `pnpm --filter @workspace/db run push` (production containers do this on boot)
- **Server Members Intent**: Required in Discord Developer Portal
- **Session Secret**: Generate a secure random value; never commit actual secrets
- **API Codegen**: After regenerating, `lib/api-zod/src/index.ts` must be manually restored (see gotchas in replit.md)
- **Canvas Fonts**: Always use bundled fonts; system fonts not available in containers
- **Workspace Typechecks**: `pnpm run typecheck` validates all packages before build

## Documentation

- `docs/NORTHFLANK.md` — Deploy on Northflank
- `docs/RAILWAY.md` — Deploy on Railway
- `replit.md` — Detailed architecture, dev commands, gotchas
- `.env.example` — All configurable environment variables
- `lib/api-spec/openapi.yaml` — Complete API specification
- `lib/db/src/schema/` — Database structure and relationships

## Legal

- **[Terms of Service](./TERMS_OF_SERVICE.md)** — Please read before using the Service
- **[Privacy Policy](./PRIVACY_POLICY.md)** — How we handle your data

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes and test thoroughly
4. Submit a pull request with a clear description

Please ensure all TypeScript checks pass (`pnpm run typecheck`) before submitting.

## License

This project is licensed under the **MIT License** — see the LICENSE file for details.

## Links

- **GitHub**: https://github.com/kaosregulator/Artemis-Prime
- **Discord**: [Add the bot to your server](https://discord.com/developers/applications)
- **Support**: Open an issue on GitHub

## Support & Questions

- **Bug Reports**: Open an issue with reproduction steps
- **Feature Requests**: Discuss in issues or pull requests

---

**Made for gaming communities**
