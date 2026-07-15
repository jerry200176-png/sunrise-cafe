#!/usr/bin/env bash
# Apply catalog RLS read-only migration via psql. Refuses placeholder URLs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$ROOT/supabase/migration-rls-catalog-read-only.sql"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL not set" >&2
  exit 1
fi
if [[ "$SUPABASE_DB_URL" == *"[ref]"* || "$SUPABASE_DB_URL" == *"[region]"* || "$SUPABASE_DB_URL" == *placeholder* ]]; then
  echo "ERROR: SUPABASE_DB_URL is a placeholder" >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql required" >&2
  exit 3
fi

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$SQL"
psql "$SUPABASE_DB_URL" -c "SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('branches','rooms','settings') ORDER BY 1,2;"
echo "APPLY_RLS_OK"
