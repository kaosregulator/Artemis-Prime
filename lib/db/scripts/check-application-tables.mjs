#!/usr/bin/env node
/**
 * Ensures APPLICATION_TABLES stays in sync with every pgTable("...") in schema/.
 * Run: node ./scripts/check-application-tables.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tablesFile = readFileSync(
  path.join(root, "src/applicationTables.ts"),
  "utf8",
);
const listed = new Set(
  [...tablesFile.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]),
);

const schemaDir = path.join(root, "src/schema");
const fromSchema = new Set();
for (const file of readdirSync(schemaDir)) {
  if (!file.endsWith(".ts") || file === "index.ts") continue;
  const text = readFileSync(path.join(schemaDir, file), "utf8");
  for (const m of text.matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)) {
    fromSchema.add(m[1]);
  }
}

const missing = [...fromSchema].filter((t) => !listed.has(t)).sort();
const extra = [...listed].filter((t) => !fromSchema.has(t)).sort();

if (missing.length || extra.length) {
  console.error("applicationTables.ts is out of sync with schema/");
  if (missing.length) console.error("  missing from whitelist:", missing.join(", "));
  if (extra.length) console.error("  extra in whitelist:", extra.join(", "));
  process.exit(1);
}

console.log(
  `OK: ${listed.size} application tables whitelisted for drizzle-kit push`,
);
