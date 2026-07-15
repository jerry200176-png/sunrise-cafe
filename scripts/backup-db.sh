#!/usr/bin/env bash
# Cross-platform DB backup (Linux/macOS/CI). Requires pg_dump + SUPABASE_DB_URL.
# Usage: ./scripts/backup-db.sh [output_dir]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL not set" >&2
  exit 1
fi

if [[ "$SUPABASE_DB_URL" == *"[ref]"* || "$SUPABASE_DB_URL" == *"[region]"* || "$SUPABASE_DB_URL" == *placeholder* ]]; then
  echo "ERROR: SUPABASE_DB_URL looks like a placeholder — refusing to run" >&2
  exit 2
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not installed" >&2
  exit 3
fi

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT_FILE="$OUT_DIR/sunrise-cafe_${STAMP}.sql"

echo "Backing up to $OUT_FILE"
pg_dump "$SUPABASE_DB_URL" --no-password --format=plain --file="$OUT_FILE"
BYTES="$(wc -c <"$OUT_FILE" | tr -d ' ')"
if [[ "$BYTES" -lt 1000 ]]; then
  echo "ERROR: backup file suspiciously small ($BYTES bytes)" >&2
  exit 4
fi
echo "OK bytes=$BYTES"

# prune
find "$OUT_DIR" -name 'sunrise-cafe_*.sql' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
echo "$OUT_FILE"
