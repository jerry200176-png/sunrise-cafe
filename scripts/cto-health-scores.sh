#!/usr/bin/env bash
# Calculate health scores from documented metrics (HEALTH_SCORES.md)
# Usage: npm run cto:health

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"

echo "═══════════════════════════════════════════════════════════"
echo "  CTO Health Scores (calculated)"
echo "  $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')"
echo "═══════════════════════════════════════════════════════════"
echo

# ── Collect signals ───────────────────────────────────────────
LOCAL_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
PROD_SHA="$(curl -sf --max-time 10 "${PROD_URL}/api/version" 2>/dev/null | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | cut -c1-7 || echo unknown)"
HEALTH_OK="$(curl -sf --max-time 10 "${PROD_URL}/api/booking-health" 2>/dev/null | grep -qE '"ok"[[:space:]]*:[[:space:]]*true' && echo 1 || echo 0)"

TEST_COUNT="$(npm test 2>&1 | sed -n 's/.*Tests[[:space:]]*\([0-9]*\) passed.*/\1/p' | tail -1 || echo 0)"
TEST_COUNT="${TEST_COUNT:-0}"

CI_SUCCESS=10
CI_TOTAL=10
if command -v gh >/dev/null 2>&1; then
  CI_JSON="$(gh run list --branch main --limit 10 --json conclusion 2>/dev/null || echo '[]')"
  CI_TOTAL="$(echo "$CI_JSON" | jq 'length' 2>/dev/null || echo 10)"
  CI_SUCCESS="$(echo "$CI_JSON" | jq '[.[] | select(.conclusion == "success")] | length' 2>/dev/null || echo 10)"
fi

DRAFT_PRS=0
OPEN_PRS=0
DEP_FAIL=0
if command -v gh >/dev/null 2>&1; then
  PR_JSON="$(gh pr list --state open --limit 50 --json isDraft,headRefName 2>/dev/null || echo '[]')"
  DRAFT_PRS="$(echo "$PR_JSON" | jq '[.[] | select(.isDraft)] | length' 2>/dev/null || echo 0)"
  OPEN_PRS="$(echo "$PR_JSON" | jq 'length' 2>/dev/null || echo 0)"
  DEP_FAIL="$(echo "$PR_JSON" | jq '[.[] | select(.headRefName | startswith("dependabot"))] | length' 2>/dev/null || echo 0)"
fi

# npm audit counts (from metadata — reliable across npm versions)
npm audit --json >/tmp/cto-audit.json 2>/dev/null || echo '{}' >/tmp/cto-audit.json
CRITICAL="$(jq -r '.metadata.vulnerabilities.critical // 0' /tmp/cto-audit.json 2>/dev/null)"
HIGH="$(jq -r '.metadata.vulnerabilities.high // 0' /tmp/cto-audit.json 2>/dev/null)"
MODERATE="$(jq -r '.metadata.vulnerabilities.moderate // 0' /tmp/cto-audit.json 2>/dev/null)"
CRITICAL="${CRITICAL:-0}"
HIGH="${HIGH:-0}"
MODERATE="${MODERATE:-0}"

# ── §1 Production ───────────────────────────────────────────
PROD=0
[[ "$HEALTH_OK" == "1" ]] && PROD=$((PROD + 30))
[[ "$PROD_SHA" != "unknown" && "$LOCAL_SHA" != "unknown" && "$PROD_SHA" == "$LOCAL_SHA" ]] && PROD=$((PROD + 30))
if [[ "$CI_TOTAL" -gt 0 ]]; then
  PROD=$((PROD + (CI_SUCCESS * 25 / CI_TOTAL)))
fi
if [[ "$TEST_COUNT" -gt 0 ]]; then
  TC=$((TEST_COUNT / 10))
  [[ $TC -gt 15 ]] && TC=15
  PROD=$((PROD + TC))
fi

# ── §2 Security ─────────────────────────────────────────────
SEC=70  # RBAC payment+reservation+deny-by-default baseline (25+25+20)
AUDIT_SCORE=$((30 - CRITICAL * 15 - HIGH * 8 - MODERATE * 2))
[[ $AUDIT_SCORE -lt 0 ]] && AUDIT_SCORE=0
SEC=$((SEC + AUDIT_SCORE))
[[ $SEC -gt 100 ]] && SEC=100

# ── §3 GitHub ─────────────────────────────────────────────────
GH=100
GH=$((GH - DRAFT_PRS * 5))
NON_DEP=$((OPEN_PRS - DRAFT_PRS))
[[ $NON_DEP -gt 0 ]] && GH=$((GH - 3))
[[ $DEP_FAIL -gt 0 ]] && GH=$((GH - 10))
[[ $GH -lt 0 ]] && GH=0

# ── §4 Product (checklist) ────────────────────────────────────
PROD_Q=85  # guest auth, double-book, pricing, payments, waitlist, closed_dates code, cron alert
# migration pending: no code deduction here (CX handles)

# ── §5 CX ─────────────────────────────────────────────────────
CX=75
# migrations pending: -10 overlap, -10 closed_dates column
CX=$((CX - 20))

# ── §6 Revenue ────────────────────────────────────────────────
REV=70  # cron+waitlist+keywords+deadline; KPI not measured

# ── §7 DX ─────────────────────────────────────────────────────
DX=0
[[ "$CI_SUCCESS" == "$CI_TOTAL" ]] && DX=$((DX + 30))
DX=$((DX + 25 + 20))  # SSOT docs + snapshot
[[ "$TEST_COUNT" -ge 100 ]] && DX=$((DX + 25))

# ── Overall ───────────────────────────────────────────────────
OVERALL=$(( (PROD * 25 + SEC * 20 + GH * 10 + PROD_Q * 15 + CX * 15 + REV * 10 + DX * 5) / 100 ))

echo "## Calculated Scores"
echo
printf "| Dimension | Score | Evidence |\n"
printf "|-----------|------:|----------|\n"
printf "| Production stability | %d | health=%s sha=%s/%s ci=%s/%s tests=%s |\n" "$PROD" "$HEALTH_OK" "$PROD_SHA" "$LOCAL_SHA" "$CI_SUCCESS" "$CI_TOTAL" "$TEST_COUNT"
printf "| Security | %d | audit crit=%s high=%s mod=%s |\n" "$SEC" "$CRITICAL" "$HIGH" "$MODERATE"
printf "| GitHub governance | %d | open=%s draft=%s dep_open=%s |\n" "$GH" "$OPEN_PRS" "$DRAFT_PRS" "$DEP_FAIL"
printf "| Product quality | %d | checklist |\n" "$PROD_Q"
printf "| Customer experience | %d | migrations pending -20 |\n" "$CX"
printf "| Revenue reliability | %d | KPIs unmeasured |\n" "$REV"
printf "| Developer experience | %d | |\n" "$DX"
printf "| **Overall** | **%d** | weighted |\n" "$OVERALL"
echo
echo "Paste into EXECUTIVE_DASHBOARD.md §2"
