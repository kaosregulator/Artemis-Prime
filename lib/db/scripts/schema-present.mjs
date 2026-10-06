#!/usr/bin/env node
/**
 * Exit 0 when every Artemis Prime application table already exists in `public`.
 * Exit 1 when any are missing (or DATABASE_URL is unset / unreachable).
 *
 * Used by push-schema.sh so restored production databases (Railway → Northflank)
 * do not run drizzle-kit push. Push against tables the app role does not own
 * fails with `must be owner of table …` because introspection cannot see PKs /
 * uniques and then tries to re-ADD them.
 *
 * Run: node ./scripts/schema-present.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tablesFile = readFileSync(
  path.join(root, "src/applicationTables.ts"),
  "utf8",
);
const required = [
  ...tablesFile.matchAll(/"([a-z0-9_]+)"/g),
].map((m) => m[1]);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows } = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = ANY($1::text[])`,
    [required],
  );
  const present = new Set(rows.map((r) => r.table_name));
  const missing = required.filter((t) => !present.has(t));
  if (missing.length) {
    console.log(
      `Schema incomplete — missing ${missing.length} table(s): ${missing.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `All ${required.length} application tables present in public schema`,
  );
  process.exit(0);
} catch (err) {
  console.error("schema-present check failed:", err?.message ?? err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
