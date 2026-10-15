#!/usr/bin/env bash
# Runs supabase/tests/orders-anon-insert-revoke.test.sql against a throwaway
# local PostgreSQL cluster. Never point this at a real database.
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/initdb" ] || { echo "initdb not found; set PG_BIN" >&2; exit 2; }
WORK="$(mktemp -d)"
cleanup() { "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -w start >/dev/null
"$PG_BIN/psql" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/orders-anon-insert-revoke.test.sql 2>&1 | grep -E "ok - |ERROR|FAILED"
echo "orders anon-insert revoke SQL scenarios: PASS"
