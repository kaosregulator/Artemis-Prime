/**
 * Tests for schema-present / push-skip behavior used on restored production DBs.
 *
 * These do not require a live Postgres — they verify the application table
 * whitelist used by schema-present.mjs stays aligned with schema/.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("schema-present / application table whitelist", () => {
  it("lists every pgTable name for presence checks", () => {
    const tablesFile = readFileSync(
      path.join(root, "src/applicationTables.ts"),
      "utf8",
    );
    const listed = new Set(
      [...tablesFile.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]),
    );

    const fromSchema = new Set();
    const schemaDir = path.join(root, "src/schema");
    for (const file of readdirSync(schemaDir)) {
      if (!file.endsWith(".ts") || file === "index.ts") continue;
      const text = readFileSync(path.join(schemaDir, file), "utf8");
      for (const m of text.matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)) {
        fromSchema.add(m[1]);
      }
    }

    assert.deepEqual(
      [...listed].sort(),
      [...fromSchema].sort(),
      "applicationTables.ts must match schema pgTable names (schema-present relies on this)",
    );
    assert.equal(listed.size, 26);
  });

  it("push-schema.sh skips push when tables already exist", () => {
    const script = readFileSync(
      path.join(root, "scripts/push-schema.sh"),
      "utf8",
    );
    assert.match(script, /schema-present\.mjs/);
    assert.match(script, /Application tables already exist — skipping/);
    assert.match(script, /FORCE_SCHEMA_PUSH/);
    assert.match(script, /SKIP_SCHEMA_PUSH/);
  });
});
