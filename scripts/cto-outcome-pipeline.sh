#!/usr/bin/env bash
# Outcome Pipeline — fetch production metrics and sync OUTCOME_LOG.md
# Usage: npm run cto:outcomes
# Requires: CTO_OUTCOME_SECRET or CRON_SECRET in env (or .env.local)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
OUTCOME_FILE="docs/internal/executive/OUTCOME_LOG.md"
SECRET="${CTO_OUTCOME_SECRET:-${CRON_SECRET:-}}"

if [[ -z "$SECRET" ]]; then
  if [[ -f .env.local ]]; then
    SECRET="$(grep -E '^CTO_OUTCOME_SECRET=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
    [[ -z "$SECRET" ]] && SECRET="$(grep -E '^CRON_SECRET=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  fi
fi

echo "═══════════════════════════════════════════════════════════"
echo "  Outcome Pipeline — production metrics"
echo "  $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')"
echo "═══════════════════════════════════════════════════════════"
echo

if [[ -z "$SECRET" ]]; then
  echo "⚠️  CTO_OUTCOME_SECRET not set — cannot fetch /api/cto/outcomes"
  echo "   Set in Vercel + .env.local for local sync"
  echo "   Dashboard: ${PROD_URL}/admin/executive (browser auth)"
  exit 1
fi

JSON="$(curl -sf --max-time 30 \
  -H "Authorization: Bearer ${SECRET}" \
  "${PROD_URL}/api/cto/outcomes" 2>/dev/null || echo '{}')"

STATUS="$(echo "$JSON" | jq -r '.status // "error"' 2>/dev/null || echo error)"
if [[ "$STATUS" == "error" || "$STATUS" == "null" ]]; then
  echo "❌ Failed to fetch outcomes from ${PROD_URL}/api/cto/outcomes"
  echo "$JSON" | head -c 500
  exit 1
fi

DATE="$(echo "$JSON" | jq -r '.health_block.date')"
DEPOSIT="$(echo "$JSON" | jq -r '.health_block.deposit_rate_pct // "null"')"
WAITLIST="$(echo "$JSON" | jq -r '.health_block.waitlist_conversion_pct // "null"')"
REVIEW_H="$(echo "$JSON" | jq -r '.health_block.payment_review_oldest_hours // "null"')"
MIG="$(echo "$JSON" | jq -r '.health_block.migrations_all_applied // "no"')"
OVERLAP="$(echo "$JSON" | jq -r '.health_block.overlap_constraint_active // "no"')"

echo "Status:     $STATUS"
echo "Date:       $DATE"
echo "訂金率:     ${DEPOSIT}%"
echo "候補轉換:   ${WAITLIST}%"
echo "審核最舊:   ${REVIEW_H}h"
echo "Migrations: $MIG"
echo "Overlap:    $OVERLAP"
echo

if [[ ! -f "$OUTCOME_FILE" ]]; then
  echo "⚠️  $OUTCOME_FILE not found — skip sync"
  exit 0
fi

# Replace outcome block in OUTCOME_LOG.md
TMP="$(mktemp)"
awk -v date="$DATE" -v dep="$DEPOSIT" -v wl="$WAITLIST" -v rh="$REVIEW_H" -v mig="$MIG" -v ov="$OVERLAP" '
  /^```outcome$/ { inblock=1; print; next }
  inblock && /^```$/ {
    print "date: " date
    print "deposit_rate_pct: " dep
    print "waitlist_conversion_pct: " wl
    print "payment_review_oldest_hours: " rh
    print "migrations_all_applied: " mig
    print "overlap_constraint_active: " ov
    print "evidence_source: outcome-pipeline:/api/cto/outcomes"
    print "reviewer: automated"
    print "```"
    inblock=0
    next
  }
  !inblock { print }
' "$OUTCOME_FILE" > "$TMP"
mv "$TMP" "$OUTCOME_FILE"

# Update status line after outcome block
if grep -q 'UNMEASURED' "$OUTCOME_FILE" 2>/dev/null; then
  sed -i 's/\*\*Status:\*\*.*$/\*\*Status:\*\* 🟢 **MEASURED** — auto-sync via Outcome Pipeline/' "$OUTCOME_FILE" 2>/dev/null || \
  sed -i '' 's/\*\*Status:\*\*.*$/\*\*Status:\*\* 🟢 **MEASURED** — auto-sync via Outcome Pipeline/' "$OUTCOME_FILE"
fi

echo "✅ Synced docs/internal/executive/OUTCOME_LOG.md"
echo "   Run: npm run cto:health"
