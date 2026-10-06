import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

/**
 * Managed Postgres (notably Northflank) installs monitoring extensions that
 * create views/tables in `public` owned by a privileged role — e.g.
 * `pg_stat_kcache_detail` from pg_stat_kcache.
 *
 * `drizzle-kit push` introspects every object in `schemaFilter` schemas. Objects
 * that are not in our Drizzle schema are treated as leftover and scheduled for
 * DROP. The application role is not the owner of those extension objects, so
 * push fails with: `must be owner of view pg_stat_kcache_detail`.
 *
 * Negated globs use the same tablesFilter mechanism drizzle-kit uses for
 * PostGIS (`extensionsFilters: ["postgis"]`). They keep push focused on
 * Artemis Prime application tables without requiring superuser or touching
 * extension objects. Safe on Railway too (no-op when those objects are absent).
 */
const MANAGED_POSTGRES_OBJECT_FILTERS = [
  "!pg_stat_*",
  "!pg_buffercache*",
  "!geography_columns",
  "!geometry_columns",
  "!spatial_ref_sys",
] as const;

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  schemaFilter: ["public"],
  tablesFilter: [...MANAGED_POSTGRES_OBJECT_FILTERS],
  extensionsFilters: ["postgis"],
});
