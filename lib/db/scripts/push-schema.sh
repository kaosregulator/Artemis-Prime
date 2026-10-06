#!/bin/sh
# Apply schema with drizzle-kit push only when application tables are missing.
#
# Restored production dumps (e.g. Railway → Northflank) keep table ownership on
# the dump/restore role. The app DATABASE_URL role can read/write via GRANTs but
# is not the owner. Against non-owned tables, drizzle-kit introspection misses
# primary keys / unique constraints and emits `ALTER TABLE … ADD PRIMARY KEY`,
# which fails with `must be owner of table …`. That must not block boot when
# the production schema is already present.
#
# Fresh databases (no application tables) still run push to create them.
# Additive column healing remains in ensureSchema() at Node boot.
#
# Override: FORCE_SCHEMA_PUSH=1 always runs push (may fail if app is not owner).
#          SKIP_SCHEMA_PUSH=1 always skips push.
set -eu

cd "$(dirname "$0")/.."

if [ "${SKIP_SCHEMA_PUSH:-}" = "1" ] || [ "${SKIP_SCHEMA_PUSH:-}" = "true" ]; then
  echo "SKIP_SCHEMA_PUSH set — skipping drizzle-kit push."
  exit 0
fi

if [ "${FORCE_SCHEMA_PUSH:-}" != "1" ] && [ "${FORCE_SCHEMA_PUSH:-}" != "true" ]; then
  set +e
  node ./scripts/schema-present.mjs
  PRESENT=$?
  set -e
  if [ "$PRESENT" -eq 0 ]; then
    echo "Application tables already exist — skipping drizzle-kit push to preserve production data."
    echo "Boot will still run additive ensureSchema() for missing columns the app role can alter."
    exit 0
  fi
fi

echo "Applying application schema via drizzle-kit push (whitelisted tables only)..."

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

set +e
CI=true pnpm exec drizzle-kit push --config ./drizzle.config.ts >"$LOG" 2>&1
CODE=$?
set -e

cat "$LOG"

if grep -Eiq 'must be owner of|severity:[[:space:]]*'\''?ERROR'\''?|^error:' "$LOG"; then
  echo "Schema push failed: unmanaged Postgres object, ownership, or ERROR in drizzle-kit output." >&2
  echo "Only tables in lib/db/src/applicationTables.ts are managed; extension views must not be dropped." >&2
  echo "If this database was restored from another host, tables may not be owned by the app role —" >&2
  echo "reassign ownership once, or leave SKIP_SCHEMA_PUSH / auto-skip when tables already exist." >&2
  exit 1
fi

exit "$CODE"
