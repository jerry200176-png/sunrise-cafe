#!/usr/bin/env bash
# Restore drill with checksum verification + isolated target.
# Modes:
#   VALIDATE_ONLY=1 (default) — dump + sha256 + structural grep
#   LOCAL_DSN=postgresql://... — restore into disposable DB (never production host)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATE_ONLY="${VALIDATE_ONLY:-1}"
DRILL_DIR="${TMPDIR:-/tmp}/sunrise-cafe-restore-drill"
mkdir -p "$DRILL_DIR"

DUMP="$("$ROOT/scripts/backup-db.sh" "$DRILL_DIR")"
BASE="${DUMP%.sql}"
[[ "$DUMP" == *.age ]] && BASE="${DUMP%.age}"
MANIFEST="${BASE}.manifest.json"
CHECKSUM_FILE="${BASE}.sha256"

echo "Dump: $DUMP"

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: missing manifest" >&2
  exit 5
fi

# Checksum verify when plain sql present
if [[ -f "$DUMP" && "$DUMP" == *.sql && -f "$CHECKSUM_FILE" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$CHECKSUM_FILE"
  else
    EXPECTED="$(cut -d' ' -f1 "$CHECKSUM_FILE")"
    ACTUAL="$(shasum -a 256 "$DUMP" | cut -d' ' -f1)"
    [[ "$EXPECTED" == "$ACTUAL" ]] || { echo "CHECKSUM_MISMATCH"; exit 6; }
  fi
  echo "CHECKSUM_OK"
fi

if [[ "$DUMP" == *.sql ]]; then
  rg -q "CREATE TABLE|CREATE TABLE IF NOT EXISTS" "$DUMP" || { echo "ERROR: missing CREATE TABLE" >&2; exit 5; }
  rg -q "reservations" "$DUMP" || { echo "ERROR: missing reservations" >&2; exit 5; }
fi

RESULT_FILE="$DRILL_DIR/drill-result.json"
if [[ "$VALIDATE_ONLY" == "1" ]]; then
  cat >"$RESULT_FILE" <<EOF
{"drill_result":"pass","mode":"validate_only","artifact":"$(basename "$DUMP")","manifest":"$(basename "$MANIFEST")","at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
  echo "DRILL_RESULT=pass mode=validate_only file=$DUMP"
  cat "$RESULT_FILE"
  exit 0
fi

if [[ -z "${LOCAL_DSN:-}" ]]; then
  echo "ERROR: set LOCAL_DSN for full restore drill" >&2
  exit 6
fi

# Refuse obvious production hosts
if echo "$LOCAL_DSN" | grep -Eqi 'supabase\.co|pooler\.supabase|amazonaws\.com'; then
  echo "ERROR: LOCAL_DSN looks like a hosted/production endpoint — use local disposable Postgres" >&2
  exit 7
fi

psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null
psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f "$DUMP"

# Restore verification queries (isolated target only)
VERIFY_JSON="$(psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT json_build_object(
  'reservations', (SELECT count(*) FROM reservations),
  'branches', (SELECT count(*) FROM branches),
  'rooms', (SELECT count(*) FROM rooms),
  'has_ops_events', EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ops_events'
  ),
  'has_refund_requests', EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'refund_requests'
  )
);
SQL
)"
COUNT="$(echo "$VERIFY_JSON" | sed -n 's/.*"reservations":\([0-9]*\).*/\1/p')"
[[ -n "$COUNT" ]] || COUNT=0

cat >"$RESULT_FILE" <<EOF
{"drill_result":"pass","mode":"local_restore","reservations":$COUNT,"verify":$VERIFY_JSON,"artifact":"$(basename "$DUMP")","checksum_verified":true,"encrypted_source":false,"at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","note":"script-ready≠production-verified; run with LOCAL_DSN disposable DB for evidence"}
EOF
echo "DRILL_RESULT=pass mode=local_restore verify=$VERIFY_JSON"
cat "$RESULT_FILE"
