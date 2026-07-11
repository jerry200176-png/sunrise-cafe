#!/usr/bin/env bash
# Verify which Founder permissions are available in this runtime.
# Usage: npm run cto:verify-permissions

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
SCORE=0
MAX=6

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

echo "Founder Permissions Probe ($(date -u +%Y-%m-%dT%H:%MZ))"
echo

[[ -n "${VERCEL_TOKEN:-}" ]] && check "VERCEL_TOKEN" yes "" || check "VERCEL_TOKEN" no "blocks: production deploy from agent"
[[ -n "${CTO_OUTCOME_SECRET:-}${CRON_SECRET:-}" ]] && check "CTO_OUTCOME_SECRET" yes "" || check "CTO_OUTCOME_SECRET" no "blocks: outcome auto-sync only"
[[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] && check "Supabase env" yes "" || check "Supabase env" no "blocks: live DB drift gate in GHA"
gh secret list --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" >/dev/null 2>&1 && check "GitHub secrets API" yes "" || check "GitHub secrets API" no "blocks: setting GHA secrets from agent"

LOCAL_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
PROD_SHA="$(curl -sf --max-time 10 "${PROD_URL}/api/version" 2>/dev/null | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | cut -c1-7 || echo unknown)"
[[ "$LOCAL_SHA" == "$PROD_SHA" ]] && check "SHA parity" yes "" || check "SHA parity" no "blocks: production verification only (not GitHub backlog)"

echo
echo "$SCORE / $MAX — GitHub backlog work does not require all checks."
exit 0
