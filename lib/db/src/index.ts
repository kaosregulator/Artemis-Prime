import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Bounded pool for Neon / managed Postgres.
 * Override with PG_POOL_MAX when the host allows more connections.
 */
const poolMax = Number(process.env.PG_POOL_MAX ?? 5);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
