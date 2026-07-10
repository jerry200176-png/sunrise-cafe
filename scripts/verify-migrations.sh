#!/usr/bin/env bash
# List migration files and remind to check schema_migrations in Supabase.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/supabase"

echo "=== Sunrise Cafe migration files ==="
echo ""
count=0
for f in "$MIG_DIR"/migration-*.sql; do
  [ -f "$f" ] || continue
  basename "$f"
  count=$((count + 1))
done
echo ""
echo "Total: $count migration files"
echo ""
echo "Verify applied migrations in Supabase SQL Editor:"
echo "  SELECT version, name, applied_at FROM schema_migrations ORDER BY applied_at;"
echo ""
echo "See docs/MIGRATIONS.md and docs/RELEASE.md"
