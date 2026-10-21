#!/usr/bin/env bash
# Source me. Resolves SUPABASE_DB_URL the same way the migration steps do: use the
# repo secret unless it is empty/a placeholder, else pull a Postgres URL from the
# Vercel production env with the existing VERCEL_TOKEN. Never prints values.
if [ -z "${SUPABASE_DB_URL:-}" ] || echo "${SUPABASE_DB_URL:-}" | grep -q '\[region\]'; then
  if [ -n "${VERCEL_TOKEN:-}" ]; then
    bash scripts/vercel-production-env.sh .env.vercel.prod >/dev/null
    for key in POSTGRES_URL POSTGRES_URL_NON_POOLING POSTGRES_PRISMA_URL SUPABASE_DB_URL DATABASE_URL DIRECT_URL; do
      val=$(grep -E "^${key}=" .env.vercel.prod 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)
      if [ -n "$val" ] && ! echo "$val" | grep -q '\[region\]'; then export "$key=$val"; fi
    done
    if [ -z "${SUPABASE_DB_URL:-}" ] || echo "${SUPABASE_DB_URL:-}" | grep -q '\[region\]'; then
      export SUPABASE_DB_URL="${POSTGRES_URL_NON_POOLING:-${POSTGRES_URL:-${POSTGRES_PRISMA_URL:-${DATABASE_URL:-${DIRECT_URL:-}}}}}"
    fi
  fi
fi
