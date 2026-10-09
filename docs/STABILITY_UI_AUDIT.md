# Artemis Prime — Stability & Components V2 Audit

## Incident analysis (confirmed vs unproven)

| Observation | Verdict | Evidence |
|---|---|---|
| `serviceOrderCard` timed out after 20s | **Confirmed soft-timeout bug** | `render-pool.ts` rejected the promise but did **not** terminate the worker; work kept running on the sole render thread |
| `poolSize: 1` | **By design** for 256 MB hosts | Hardcoded; not itself a crash cause |
| Discord `10003` Unknown Channel on orders 3/28 | **Confirmed retry noise** | `refreshOrderMessages` logged and continued; stale `channelId` / message IDs stayed in DB → every rehydrate/refresh hit them again |
| Container restarts / `Process terminated` | **Unproven root** | Soft-timeout zombies + unbounded photo cache + overlapping ticks are plausible pressure; no heap dump from the incident window |
| Bloxscout 900 s / 17 games | **Not implicated** | Separate SQLite snapshot job; no evidence it caused the render timeout |
| `must be owner of table clan_members` | **Separate, non-fatal** | `ensureSchema` already skips on Postgres `42501`; app continues |

**Most likely crash/restart contributors (ranked):** (1) timed-out canvas work continuing on the only worker, (2) service-order rehydrate repeatedly fetching dead channels and re-rendering, (3) no graceful SIGTERM → hard kills under memory pressure. Not proven as exclusive cause without production metrics from that window.

## Fixes shipped in this change set

1. **Render pool** — serialized jobs, bounded queue (8), hard timeout terminates + rebuilds worker, metrics, shutdown.
2. **Service orders** — clear stale Discord refs on 10003/10008/50001; rehydrate mutex + 14-day terminal cutoff; photo-cache eviction; skip canvas on text-only status updates.
3. **Scheduler** — overlap guard, idempotent start, stoppable interval, tick metrics.
4. **Graceful shutdown** — SIGTERM/SIGINT on API + bot worker (pool, Discord, scout, render pool).
5. **Diagnostics** — `/api/diagnostics` (token or loopback), memory sampling in bot worker, DB pool stats.
6. **DB** — bounded `pg` pool; Drizzle index aligned with `service_orders_guild_status_idx`.
7. **Components V2** — shared primitives; setup hub pilot; service-order place panel + ticket/board panels.

## UI migration map

| Surface | Now | Target |
|---|---|---|
| Setup main hub | **V2 (done)** | Keep; migrate sub-panels next |
| Service order place panel | **V2 (done)** | Keep |
| Service order ticket/board | **V2 (done)** + canvas when photos | Prefer text V2 for status-only; canvas only with photos |
| Setup sub-panels / wizard | Classic embeds | V2 sections |
| Command center / tracker / alt board | Canvas + embeds | Keep canvas; optional V2 chrome |
| Scout / Roblox / Market / Link hubs | Canvas | Stay canvas-first |
| Warnings / disputes / ToD DMs | Embeds | Plain embeds OK |
| Dense admin tables | Web dashboard | Prefer web |

## Deployment / rollback

**Deploy**
1. Set optional `DIAGNOSTICS_TOKEN` for `/api/diagnostics`.
2. Optional `PG_POOL_MAX` (default 5).
3. Deploy normally; no destructive migration required (additive index only if missing).
4. Smoke: `/api/healthz`, `/setup` hub opens, place-order panel posts, claim/complete an order.

**Rollback**
1. Revert the release image/commit.
2. Existing V2 messages remain V2 (Discord cannot convert back to embeds automatically) — re-post place panel / setup hub if needed; order rows and custom IDs are preserved.
3. Stale Discord ID clears are reversible only by restoring DB backup (clears are nulling message/channel refs, not deleting orders).
