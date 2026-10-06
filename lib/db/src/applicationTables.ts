/**
 * Canonical list of Artemis Prime application tables managed by drizzle-kit push.
 *
 * Keep in sync with `pgTable("...")` names under `./schema`.
 * Enforce with `pnpm --filter @workspace/db check-tables`.
 *
 * Managed Postgres hosts (Northflank) install extension views such as
 * `pg_stat_kcache_detail` in `public`. By whitelisting only these tables,
 * `drizzle-kit push` never tries to DROP/ALTER those unmanaged objects.
 */
export const APPLICATION_TABLES = [
  "activity_categories",
  "activity_logs",
  "alt_daily_logs",
  "audit_logs",
  "clan_members",
  "clans",
  "connect_sessions",
  "dashboards",
  "disputes",
  "member_notes",
  "notifications",
  "reminders",
  "service_order_reviews",
  "service_orders",
  "sessions",
  "tickets",
  "tod_anonymous",
  "tod_challenges",
  "tod_custom_content",
  "tod_players",
  "tracked_accounts",
  "vacations",
  "warnings",
  "xp_entries",
  "xp_submissions",
  "xp_week_history",
] as const;

export type ApplicationTable = (typeof APPLICATION_TABLES)[number];
