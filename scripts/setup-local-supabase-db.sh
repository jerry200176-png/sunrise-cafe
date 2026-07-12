#!/usr/bin/env bash
# Idempotent local dev DB setup for the Sunrise Cafe app.
#
# Applies the repo SQL (schema + migrations + RLS) to the LOCAL Supabase
# Postgres started by `supabase start`, grants the standard Supabase roles
# access, adds the `min_capacity` column that the app expects (missing from
# the tracked migrations), and seeds one demo branch + rooms if empty.
#
# Safe to re-run. Requires: `supabase start` already running (db container
# `supabase_db_<project_id>`), docker available to the current user.
#
# Usage: bash scripts/setup-local-supabase-db.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Locate the local Supabase Postgres container (name is supabase_db_<project_id>).
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -1 || true)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "ERROR: local Supabase DB container not found. Run 'supabase start' first." >&2
  exit 1
fi
echo "Using DB container: $DB_CONTAINER"

psql_stop() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_go()   { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres "$@"; }

# schema.sql drops/recreates `reservations`, so it is only safe on a fresh DB
# (re-running fails once payment_events has an FK to reservations). Only run the
# schema + migrations + RLS on first setup; everything after is idempotent.
INITIALIZED="$(psql_go -t -A -c "SELECT to_regclass('public.reservations') IS NOT NULL;")"
if [[ "$INITIALIZED" != "t" ]]; then
  echo "== schema.sql =="
  psql_stop < supabase/schema.sql >/dev/null

  echo "== migrations =="
  # schema-versions first (creates schema_migrations tracker), then the rest.
  # Migrations are idempotent/additive; the legacy price_per_hour backfill
  # (rooms-weekday-weekend) is a no-op on a fresh schema, so don't stop on error.
  psql_stop < supabase/migration-schema-versions.sql >/dev/null
  for f in $(ls supabase/migration-*.sql | grep -v schema-versions | sort); do
    psql_go < "$f" >/dev/null 2>&1 || echo "  (non-fatal) skipped/failed: $f"
  done

  echo "== RLS policies =="
  psql_go < supabase/rls-policies.sql >/dev/null 2>&1 || true
else
  echo "== schema/migrations already applied; skipping =="
fi

echo "== grants (anon/authenticated/service_role) =="
psql_go >/dev/null <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL

echo "== app-expected column not in tracked migrations =="
psql_stop -c "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS min_capacity INTEGER;" >/dev/null

echo "== seed demo branch + rooms (only if empty) =="
COUNT="$(psql_go -t -A -c "SELECT count(*) FROM branches;")"
if [[ "$COUNT" == "0" ]]; then
  psql_stop < supabase/seed-branches.sql >/dev/null
  psql_stop < supabase/seed-rooms.sql >/dev/null
  echo "  seeded."
else
  echo "  branches already present ($COUNT); skipping seed."
fi

echo "Local Supabase DB ready."
