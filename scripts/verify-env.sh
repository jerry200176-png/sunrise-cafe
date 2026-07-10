#!/usr/bin/env bash
# Validate required environment variables for local dev / CI
set -euo pipefail

STRICT="${VERIFY_ENV_STRICT:-0}"
WARN=0
FAIL=0

check() {
  local name="$1"
  local required="${2:-0}"
  if [[ -n "${!name:-}" ]]; then
    echo "OK   $name"
  elif [[ "$required" == "1" ]]; then
    echo "FAIL $name (required)"
    FAIL=1
  else
    echo "WARN $name (optional)"
    WARN=1
  fi
}

echo "=== Environment validation ==="
echo ""

check NEXT_PUBLIC_SUPABASE_URL 1
check NEXT_PUBLIC_SUPABASE_ANON_KEY 1
check SUPABASE_SERVICE_ROLE_KEY 1
check ADMIN_PASSWORD 1

check SESSION_SECRET 0
check CRON_SECRET 0
check LINE_CHANNEL_ACCESS_TOKEN 0
check LINE_CHANNEL_SECRET 0
check LINE_GROUP_ID 0
check LINE_CUSTOMER_ACCESS_TOKEN 0
check LINE_LOGIN_CHANNEL_ID 0
check LINE_LOGIN_CHANNEL_SECRET 0
check UPSTASH_REDIS_REST_URL 0
check UPSTASH_REDIS_REST_TOKEN 0
check NEXT_PUBLIC_SENTRY_DSN 0

echo ""
if [[ $FAIL -eq 1 ]]; then
  echo "Required variables missing. See docs/ENV.md"
  exit 1
fi

if [[ "$STRICT" == "1" && $WARN -eq 1 ]]; then
  echo "Strict mode: optional integrations recommended for production."
  exit 1
fi

echo "Environment OK"
exit 0
