#!/usr/bin/env bash
# Fail if production Supabase is missing critical migrations.
# Requires CHECK_MIGRATION_DRIFT=1 and real Supabase env vars.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ -z "${CHECK_MIGRATION_DRIFT:-}" ]]; then
  echo "CHECK_MIGRATION_DRIFT not set — skip"
  exit 0
fi

if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Supabase credentials missing — skip remote drift check"
  exit 0
fi

CHECK_MIGRATION_DRIFT=1 npm test -- src/lib/migration-drift-ci.test.ts
