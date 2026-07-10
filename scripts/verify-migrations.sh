#!/usr/bin/env bash
# Verify migration files match supabase/migrations.manifest.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/supabase"
MANIFEST="$MIG_DIR/migrations.manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: Missing $MANIFEST"
  exit 1
fi

echo "=== Migration manifest verification ==="
echo ""

# Files on disk
mapfile -t DISK_FILES < <(find "$MIG_DIR" -maxdepth 1 -name 'migration-*.sql' -printf '%f\n' | sort)

# Files in manifest (requires node or python)
mapfile -t MANIFEST_FILES < <(node -e "
const m = require('$MANIFEST');
for (const f of m.migrations) console.log(f);
")

disk_count=${#DISK_FILES[@]}
manifest_count=${#MANIFEST_FILES[@]}

echo "Disk:     $disk_count migration files"
echo "Manifest: $manifest_count entries"
echo ""

fail=0

# Disk -> manifest
for f in "${DISK_FILES[@]}"; do
  if ! printf '%s\n' "${MANIFEST_FILES[@]}" | grep -qx "$f"; then
    echo "MISSING from manifest: $f"
    fail=1
  fi
done

# Manifest -> disk
for f in "${MANIFEST_FILES[@]}"; do
  if [[ ! -f "$MIG_DIR/$f" ]]; then
    echo "MISSING on disk: $f"
    fail=1
  fi
done

if [[ $fail -eq 0 ]]; then
  echo "OK: manifest matches filesystem"
else
  echo ""
  echo "Fix: add files to manifest and run npm run sync:migrations"
  exit 1
fi

echo ""
echo "Apply order (first 5 / last 5):"
for i in 0 1 2 3 4; do
  [[ $i -lt $manifest_count ]] && echo "  $((i+1)). ${MANIFEST_FILES[$i]}"
done
echo "  ..."
for i in -5 -4 -3 -2 -1; do
  idx=$((manifest_count + i))
  [[ $idx -ge 0 ]] && echo "  $((idx+1)). ${MANIFEST_FILES[$idx]}"
done

echo ""
echo "Verify in Supabase:"
echo "  SELECT version, name, applied_at FROM schema_migrations ORDER BY applied_at;"
echo ""
echo "Runtime check: GET /api/admin/schema/status"
echo "See docs/DATABASE_EVOLUTION.md"
