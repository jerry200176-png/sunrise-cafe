#!/usr/bin/env bash
# Verify which Founder permissions are available in this runtime.
# Usage: npm run cto:verify-permissions
# After adding secrets in Cursor Dashboard → Cloud Agents → Secrets, re-run this agent.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
SCORE=0
MAX=8

check() {
  local name="$1"
  local ok="$2"
  local hint="$3"
  if [[ "$ok" == "yes" ]]; then
    echo "✅ $name"
    SCORE=$((SCORE + 1))
  else
    echo "❌ $name — $hint"
  fi
}

echo "═══════════════════════════════════════════════════════════"
echo "  Founder Permissions Probe"
echo "  $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')"
echo "═══════════════════════════════════════════════════════════"
echo

# Vercel
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  check "VERCEL_TOKEN" yes ""
elif command -v vercel >/dev/null 2>&1 && vercel whoami >/dev/null 2>&1; then
  check "Vercel CLI session" yes ""
else
  check "VERCEL_TOKEN" no "Cursor Dashboard → Cloud Agents → Secrets → Runtime Secret"
fi

# Outcome sync
if [[ -n "${CTO_OUTCOME_SECRET:-}" || -n "${CRON_SECRET:-}" ]]; then
  check "CTO_OUTCOME_SECRET / CRON_SECRET" yes ""
else
  check "CTO_OUTCOME_SECRET" no "同上 Secrets tab；並設 Vercel + GitHub Actions"
fi

# Supabase (local/agent)
if [[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  check "Supabase service role" yes ""
else
  check "Supabase env" no "Secrets: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
fi

# Upstash
if [[ -n "${UPSTASH_REDIS_REST_URL:-}" && -n "${UPSTASH_REDIS_REST_TOKEN:-}" ]]; then
  check "Upstash Redis" yes ""
else
  check "Upstash Redis" no "Vercel env or Cursor Secrets"
fi

# E2E
if [[ -n "${E2E_ADMIN_PASSWORD:-}" ]]; then
  check "E2E_ADMIN_PASSWORD" yes ""
else
  check "E2E_ADMIN_PASSWORD" no "GitHub Actions Secrets（可同 ADMIN_PASSWORD）"
fi

# GitHub bot powers
if gh secret list --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo x/x)" >/dev/null 2>&1; then
  check "GitHub secrets API (integration)" yes ""
else
  check "GitHub secrets API" no "integration token 無法寫入；請在 github.com → Settings → Secrets 手動加"
fi

# Production parity
LOCAL_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
PROD_SHA="$(curl -sf --max-time 10 "${PROD_URL}/api/version" 2>/dev/null | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | cut -c1-7 || echo unknown)"
if [[ "$LOCAL_SHA" != "unknown" && "$PROD_SHA" == "$LOCAL_SHA" ]]; then
  check "Production SHA parity" yes ""
else
  check "Production SHA parity" no "main=$LOCAL_SHA prod=$PROD_SHA — vercel deploy --prod"
fi

# Outcome pipeline live test
if [[ -n "${CTO_OUTCOME_SECRET:-}${CRON_SECRET:-}" ]]; then
  if curl -sf --max-time 15 -H "Authorization: Bearer ${CTO_OUTCOME_SECRET:-$CRON_SECRET}" \
    "${PROD_URL}/api/cto/outcomes" | grep -q '"status"'; then
    check "Outcome API reachable" yes ""
  else
    check "Outcome API" no "secret 已設但 /api/cto/outcomes 失敗 — 確認 Vercel 也有同 secret"
  fi
else
  check "Outcome API" no "需 CTO_OUTCOME_SECRET"
fi

echo
echo "Available: $SCORE / $MAX checks"
echo
echo "Cursor 設定路徑（你貼 secret，下一輪 agent 自動用）："
echo "  https://cursor.com/dashboard/cloud-agents → Secrets → Runtime Secret"
echo
echo "建議一次貼上這些 key："
echo "  VERCEL_TOKEN"
echo "  CTO_OUTCOME_SECRET"
echo "  NEXT_PUBLIC_SUPABASE_URL"
echo "  SUPABASE_SERVICE_ROLE_KEY"
echo "  UPSTASH_REDIS_REST_URL"
echo "  UPSTASH_REDIS_REST_TOKEN"
echo "  E2E_ADMIN_PASSWORD"
echo
echo "GitHub Actions Secrets（github.com repo Settings，integration 無法代設）："
echo "  CTO_OUTCOME_SECRET, E2E_ADMIN_PASSWORD, SUPABASE_*, VERCEL_TOKEN"
echo
if [[ "$SCORE" -ge 6 ]]; then
  echo "→ 權限足夠，可執行: npm run cto:outcomes && npm run cto:health"
  exit 0
fi
exit 1
