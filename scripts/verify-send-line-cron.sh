#!/usr/bin/env bash
# Verify tomorrow LINE reminder cron against production.
# Usage: CRON_SECRET=xxx bash scripts/verify-send-line-cron.sh
# Or with admin cookie: ADMIN_COOKIE='admin_session=...' bash scripts/verify-send-line-cron.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
SECRET="${CRON_SECRET:-${CTO_OUTCOME_SECRET:-}}"

if [[ -z "$SECRET" && -f .env.local ]]; then
  SECRET="$(grep -E '^CRON_SECRET=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi

echo "=== send-line cron verify ==="
echo "Production: $PROD_URL"
echo

# Public checks (no auth)
VERSION="$(curl -sf --max-time 15 "$PROD_URL/api/version" || echo '{}')"
echo "1. /api/version"
echo "$VERSION" | jq '{commit: (.commit // null | tostring | .[0:7]), deployed}' 2>/dev/null || echo "$VERSION"
echo

HEALTH="$(curl -sf --max-time 15 "$PROD_URL/api/booking-health" || echo '{}')"
echo "2. /api/booking-health"
echo "$HEALTH" | jq '.' 2>/dev/null || echo "$HEALTH"
echo

CODE="$(curl -s -o /tmp/send-line-probe.json -w "%{http_code}" --max-time 15 "$PROD_URL/api/admin/reminders/send-line")"
echo "3. Cron endpoint without auth (expect 401 if CRON_SECRET required)"
echo "   GET /api/admin/reminders/send-line → HTTP $CODE"
head -c 200 /tmp/send-line-probe.json 2>/dev/null; echo
echo

if [[ -z "$SECRET" && -z "${ADMIN_COOKIE:-}" ]]; then
  echo "⚠️  未設定 CRON_SECRET / ADMIN_COOKIE — 無法查 job_runs 與明日訂位"
  echo "   Vercel → Settings → Environment Variables → CRON_SECRET"
  echo "   或後台登入後帶 admin_session cookie 再跑此腳本"
  exit 0
fi

AUTH=()
if [[ -n "$SECRET" ]]; then
  AUTH=(-H "Authorization: Bearer $SECRET")
elif [[ -n "${ADMIN_COOKIE:-}" ]]; then
  AUTH=(-H "Cookie: $ADMIN_COOKIE")
fi

REPORT="$(curl -sf --max-time 30 "${AUTH[@]}" "$PROD_URL/api/admin/reminders/verify" || echo '{"ok":false}')"
echo "4. /api/admin/reminders/verify"
echo "$REPORT" | jq '.' 2>/dev/null || echo "$REPORT"
