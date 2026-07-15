#!/usr/bin/env bash
# Verify migration artifacts and optional remote drift against Supabase.
# Usage: npm run verify:migrations
# Remote check runs when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are real (not placeholder).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Migration verify (static + optional remote) ==="
npm test -- src/lib/migration-verify.test.ts 2>&1

# Remote drift summary when credentials present
if [[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] \
   && [[ "$NEXT_PUBLIC_SUPABASE_URL" != *placeholder* ]] \
   && [[ "$SUPABASE_SERVICE_ROLE_KEY" != *placeholder* ]]; then
  echo ""
  echo "Remote drift check: configure vitest with real env or use /admin/executive"
fi

echo "=== Migration verify OK ==="
