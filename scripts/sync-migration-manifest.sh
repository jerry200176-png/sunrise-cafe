#!/usr/bin/env bash
# Regenerate supabase/migrations.manifest.json from disk (sorted) — review order before commit
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/supabase"
OUT="$MIG_DIR/migrations.manifest.json"

echo "WARNING: This sorts files alphabetically. Prefer manual ordering in manifest."
echo "Listing current disk files for reference:"
find "$MIG_DIR" -maxdepth 1 -name 'migration-*.sql' -printf '%f\n' | sort

echo ""
echo "To add a new migration: edit $OUT manually and run npm run verify:migrations"
