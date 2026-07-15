#!/usr/bin/env bash
# Controlled DB backup artifact:
# - refuses placeholders
# - writes dump + sha256 + manifest JSON
# - retention by KEEP_DAYS (default 30)
# - optional encryption when BACKUP_AGE_RECIPIENT is set (age)
# Does NOT overwrite production.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL not set" >&2
  exit 1
fi

if [[ "$SUPABASE_DB_URL" == *"[ref]"* || "$SUPABASE_DB_URL" == *"[region]"* || "$SUPABASE_DB_URL" == *placeholder* ]]; then
  echo "ERROR: SUPABASE_DB_URL looks like a placeholder — refusing" >&2
  exit 2
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not installed" >&2
  exit 3
fi

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
BASENAME="sunrise-cafe_${STAMP}"
OUT_FILE="$OUT_DIR/${BASENAME}.sql"
MANIFEST="$OUT_DIR/${BASENAME}.manifest.json"
CHECKSUM="$OUT_DIR/${BASENAME}.sha256"

echo "Backing up to $OUT_FILE"
pg_dump "$SUPABASE_DB_URL" --no-password --format=plain --file="$OUT_FILE"
BYTES="$(wc -c <"$OUT_FILE" | tr -d ' ')"
if [[ "$BYTES" -lt 1000 ]]; then
  echo "ERROR: backup file suspiciously small ($BYTES bytes)" >&2
  exit 4
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$OUT_FILE" | tee "$CHECKSUM"
  DIGEST="$(cut -d' ' -f1 "$CHECKSUM")"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$OUT_FILE" | tee "$CHECKSUM"
  DIGEST="$(cut -d' ' -f1 "$CHECKSUM")"
else
  echo "ERROR: sha256sum/shasum required" >&2
  exit 5
fi

ENCRYPTED="false"
if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]] && command -v age >/dev/null 2>&1; then
  age -r "$BACKUP_AGE_RECIPIENT" -o "${OUT_FILE}.age" "$OUT_FILE"
  ENCRYPTED="true"
  # keep ciphertext as primary artifact for offsite; plain retained for local drill unless BACKUP_DROP_PLAIN=1
  if [[ "${BACKUP_DROP_PLAIN:-0}" == "1" ]]; then
    rm -f "$OUT_FILE"
    OUT_FILE="${OUT_FILE}.age"
  fi
fi

cat >"$MANIFEST" <<EOF
{
  "created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "artifact": "$(basename "$OUT_FILE")",
  "bytes": $BYTES,
  "sha256": "$DIGEST",
  "encrypted": $ENCRYPTED,
  "retention_days": $KEEP_DAYS,
  "restore_target_isolation": "never restore into production without Founder approval; use LOCAL_DSN disposable DB",
  "tool": "pg_dump"
}
EOF

echo "MANIFEST=$MANIFEST"
echo "CHECKSUM=$DIGEST"

find "$OUT_DIR" -name 'sunrise-cafe_*.sql' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
find "$OUT_DIR" -name 'sunrise-cafe_*.sha256' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
find "$OUT_DIR" -name 'sunrise-cafe_*.manifest.json' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
find "$OUT_DIR" -name 'sunrise-cafe_*.age' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true

echo "BACKUP_OK file=$OUT_FILE bytes=$BYTES"
echo "$OUT_FILE"
