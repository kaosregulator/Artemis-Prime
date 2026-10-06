#!/bin/sh
# Run drizzle-kit push and fail if Postgres ownership / ERROR lines appear.
# drizzle-kit may log errors and still exit 0; the container must not continue.
set -eu

cd "$(dirname "$0")/.."

echo "Applying application schema via drizzle-kit push (whitelisted tables only)..."

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

set +e
CI=true pnpm exec drizzle-kit push --config ./drizzle.config.ts >"$LOG" 2>&1
CODE=$?
set -e

cat "$LOG"

if grep -Eiq 'must be owner of|severity:[[:space:]]*'\''?ERROR'\''?|^error:' "$LOG"; then
  echo "Schema push failed: unmanaged Postgres object or ERROR in drizzle-kit output." >&2
  echo "Only tables in lib/db/src/applicationTables.ts are managed; extension views must not be dropped." >&2
  exit 1
fi

exit "$CODE"
