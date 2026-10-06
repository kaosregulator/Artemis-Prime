import { defineConfig } from "drizzle-kit";
import path from "path";
import { APPLICATION_TABLES } from "./src/applicationTables";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

/**
 * Managed Postgres (notably Northflank) installs monitoring extensions that
 * create views/tables in `public` owned by a privileged role — e.g.
 * `pg_stat_kcache_detail` from pg_stat_kcache.
 *
 * `drizzle-kit push` introspects objects in `schemaFilter` schemas. Anything
 * not in our Drizzle schema is treated as leftover and scheduled for DROP.
 * The app role does not own extension objects, which previously failed with:
 *   must be owner of view pg_stat_kcache_detail
 *
 * Whitelist ONLY Artemis Prime application tables so unmanaged extension
 * objects are never included in the push diff. Prefer this over negate globs
 * (`!pg_stat_*`) so newly added managed objects cannot break boot.
 *
 * Do NOT set `extensionsFilters: ["postgis"]` alongside a positive whitelist.
 * drizzle-kit turns that option into negate globs (`!geography_columns`, …).
 * Its filter treats those negate matches as “include”, which re-admits every
 * non-PostGIS unmanaged object (including `pg_stat_kcache_detail`). PostGIS
 * catalog tables are already excluded by not being in APPLICATION_TABLES.
 */
export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  schemaFilter: ["public"],
  tablesFilter: [...APPLICATION_TABLES],
});
