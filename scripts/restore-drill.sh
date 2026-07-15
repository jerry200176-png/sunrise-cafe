#!/usr/bin/env bash
# Non-destructive restore drill:
# 1) Take a backup dump
# 2) Restore into a disposable local Postgres OR validate dump with pg_restore --list / grep
# Does NOT overwrite production.
#
# Modes:
#   VALIDATE_ONLY=1 (default) — parse/validate dump header + schema markers
#   LOCAL_DSN=postgresql://... — restore into disposable DB then SELECT count
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATE_ONLY="${VALIDATE_ONLY:-1}"

DUMP="$("$ROOT/scripts/backup-db.sh" "${TMPDIR:-/tmp}/sunrise-cafe-restore-drill")"
echo "Dump: $DUMP"

# Structural checks (non-destructive)
rg -q "CREATE TABLE|CREATE TABLE IF NOT EXISTS" "$DUMP" || {
  echo "ERROR: dump missing CREATE TABLE" >&2
  exit 5
}
rg -q "reservations" "$DUMP" || {
  echo "ERROR: dump missing reservations" >&2
  exit 5
}
echo "VALIDATE_ONLY structural checks OK"

if [[ "$VALIDATE_ONLY" == "1" ]]; then
  echo "DRILL_RESULT=pass mode=validate_only file=$DUMP"
  exit 0
fi

if [[ -z "${LOCAL_DSN:-}" ]]; then
  echo "ERROR: set LOCAL_DSN for full restore drill" >&2
  exit 6
fi

psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null
psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f "$DUMP"
COUNT="$(psql "$LOCAL_DSN" -tAc "SELECT count(*) FROM reservations")"
echo "Restored reservations count=$COUNT"
echo "DRILL_RESULT=pass mode=local_restore reservations=$COUNT"
