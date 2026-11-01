#!/usr/bin/env bash
# Source this from a job with an explicitly provisioned SUPABASE_DB_URL. Never
# pull production environment files or print the connection string.
case "${SUPABASE_DB_URL:-}" in
  postgres://*|postgresql://*) ;;
  *) printf '%s\n' '::error::database URL unavailable: migrations will not run' >&2; return 1 2>/dev/null || exit 1 ;;
esac
case "${SUPABASE_DB_URL}" in
  *'[region]'*|*'[ref]'*|*placeholder*|*$'\n'*|*$'\r'*)
    printf '%s\n' '::error::invalid database URL: migrations will not run' >&2
    return 1 2>/dev/null || exit 1 ;;
esac
