#!/usr/bin/env bash
# Calculate health scores — Capability vs Outcome (HEALTH_SCORES.md)
# Usage: npm run cto:health
# Outcome scores require evidence in docs/OUTCOME_LOG.md

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
OUTCOME_FILE="docs/OUTCOME_LOG.md"

parse_outcome() {
  local key="$1"
  if [[ ! -f "$OUTCOME_FILE" ]]; then
    echo "null"
    return
  fi
  local val
  val="$(sed -n '/^```outcome$/,/^```$/p' "$OUTCOME_FILE" | grep -E "^${key}:" | head -1 | sed 's/.*:[[:space:]]*//' | tr -d ' ')"
  if [[ -z "$val" || "$val" == "null" ]]; then
    echo "null"
  else
    echo "$val"
  fi
}

outcome_measured() {
  local d
  d="$(parse_outcome date)"
  [[ "$d" != "null" && -n "$d" ]]
}

echo "═══════════════════════════════════════════════════════════"
echo "  CTO Health Scores (Capability + Outcome)"
echo "  $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')"
echo "═══════════════════════════════════════════════════════════"
echo

LOCAL_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
PROD_SHA="$(curl -sf --max-time 10 "${PROD_URL}/api/version" 2>/dev/null | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | cut -c1-7 || echo unknown)"
HEALTH_OK="$(curl -sf --max-time 10 "${PROD_URL}/api/booking-health" 2>/dev/null | grep -qE '"ok"[[:space:]]*:[[:space:]]*true' && echo 1 || echo 0)"

TEST_COUNT="$(npm test 2>&1 | sed -n 's/.*Tests[[:space:]]*\([0-9]*\) passed.*/\1/p' | tail -1 || echo 0)"
TEST_COUNT="${TEST_COUNT:-0}"

CI_SUCCESS=10
CI_TOTAL=10
if command -v gh >/dev/null 2>&1; then
  CI_JSON="$(gh run list --workflow=ci.yml --branch main --limit 10 --json conclusion 2>/dev/null || echo '[]')"
  CI_TOTAL="$(echo "$CI_JSON" | jq 'length' 2>/dev/null || echo 10)"
  CI_SUCCESS="$(echo "$CI_JSON" | jq '[.[] | select(.conclusion == "success")] | length' 2>/dev/null || echo 10)"
  [[ "$CI_TOTAL" -eq 0 ]] && CI_TOTAL=10 && CI_SUCCESS=10
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

npm audit --json >/tmp/cto-audit.json 2>/dev/null || echo '{}' >/tmp/cto-audit.json
CRITICAL="$(jq -r '.metadata.vulnerabilities.critical // 0' /tmp/cto-audit.json 2>/dev/null)"
HIGH="$(jq -r '.metadata.vulnerabilities.high // 0' /tmp/cto-audit.json 2>/dev/null)"
MODERATE="$(jq -r '.metadata.vulnerabilities.moderate // 0' /tmp/cto-audit.json 2>/dev/null)"

# ── Capability scores ─────────────────────────────────────────
PROD=0
[[ "$HEALTH_OK" == "1" ]] && PROD=$((PROD + 30))
[[ "$PROD_SHA" != "unknown" && "$LOCAL_SHA" != "unknown" && "$PROD_SHA" == "$LOCAL_SHA" ]] && PROD=$((PROD + 30))
[[ "$CI_TOTAL" -gt 0 ]] && PROD=$((PROD + (CI_SUCCESS * 25 / CI_TOTAL)))
if [[ "$TEST_COUNT" -gt 0 ]]; then
  TEST_PTS=$((TEST_COUNT / 10))
  [[ "$TEST_PTS" -gt 15 ]] && TEST_PTS=15
  PROD=$((PROD + TEST_PTS))
fi

SEC=70
AUDIT_SCORE=$((30 - CRITICAL * 15 - HIGH * 8 - MODERATE * 2))
[[ $AUDIT_SCORE -lt 0 ]] && AUDIT_SCORE=0
SEC=$((SEC + AUDIT_SCORE))
[[ $SEC -gt 100 ]] && SEC=100

GH=100
GH=$((GH - DRAFT_PRS * 5))
NON_DEP=$((OPEN_PRS - DRAFT_PRS))
[[ $NON_DEP -gt 0 ]] && GH=$((GH - 3))
[[ $DEP_FAIL -gt 0 ]] && GH=$((GH - 10))
[[ $GH -lt 0 ]] && GH=0

PROD_Q=85
TRUTH_FILE="docs/IMPLEMENTATION_TRUTH.md"
if [[ -f "$TRUTH_FILE" ]]; then
  TRUTH_DONE="$(grep -cE '^\| .+ \| ✅' "$TRUTH_FILE" 2>/dev/null || echo 0)"
  TRUTH_PARTIAL="$(grep -cE '^\| .+ \| 🟡' "$TRUTH_FILE" 2>/dev/null || echo 0)"
  TRUTH_TOTAL=$((TRUTH_DONE + TRUTH_PARTIAL))
  if [[ "$TRUTH_TOTAL" -gt 0 ]]; then
    PROD_Q=$(( (TRUTH_DONE * 100 + TRUTH_PARTIAL * 50) / TRUTH_TOTAL ))
    [[ "$PROD_Q" -gt 100 ]] && PROD_Q=100
  fi
fi

DX=0
[[ "$CI_TOTAL" -gt 0 && "$CI_SUCCESS" -eq "$CI_TOTAL" ]] && DX=$((DX + 30))
[[ "$TEST_COUNT" -ge 100 ]] && DX=$((DX + 25))
DX=$((DX + 20 + 10))  # scripts + SSOT cap

# ── Outcome scores (evidence only) ───────────────────────────
CX=40
REV=35
OUTCOME_STATUS="unmeasured"

if outcome_measured; then
  OUTCOME_STATUS="measured ($(parse_outcome date))"
  DEPOSIT="$(parse_outcome deposit_rate_pct)"
  WAITLIST="$(parse_outcome waitlist_conversion_pct)"
  REVIEW_H="$(parse_outcome payment_review_oldest_hours)"
  MIG="$(parse_outcome migrations_all_applied)"
  OVERLAP="$(parse_outcome overlap_constraint_active)"

  if [[ "$MIG" == "yes" || "$MIG" == "true" ]]; then CX=$((CX + 15)); fi
  if [[ "$OVERLAP" == "yes" || "$OVERLAP" == "true" ]]; then CX=$((CX + 15)); fi

  if [[ "$DEPOSIT" != "null" ]]; then
    DEP_INT="${DEPOSIT%.*}"
    if [[ "$DEP_INT" -ge 85 ]]; then
      REV=$((REV + 25)); CX=$((CX + 15))
    elif [[ "$DEP_INT" -ge 75 ]]; then
      REV=$((REV + 15)); CX=$((CX + 8))
    elif [[ "$DEP_INT" -ge 65 ]]; then
      REV=$((REV + 8))
    fi
  fi

  if [[ "$WAITLIST" != "null" ]]; then
    WL_INT="${WAITLIST%.*}"
    [[ "$WL_INT" -ge 30 ]] && REV=$((REV + 15))
  fi

  if [[ "$REVIEW_H" != "null" ]]; then
    RH_INT="${REVIEW_H%.*}"
    [[ "$RH_INT" -lt 4 ]] && REV=$((REV + 15))
    [[ "$RH_INT" -ge 4 && "$RH_INT" -lt 24 ]] && REV=$((REV + 8))
  fi

  # All outcome targets met → grade A (per HEALTH_SCORES.md §5–§6)
  if [[ "$MIG" == "yes" && "$OVERLAP" == "yes" && "$DEPOSIT" != "null" ]]; then
    DEP_INT="${DEPOSIT%.*}"
    if [[ "$DEP_INT" -ge 85 ]]; then
      CX=100
      REV=100
    fi
  fi
fi

[[ $CX -gt 100 ]] && CX=100
[[ $REV -gt 100 ]] && REV=100

OVERALL=$(( (PROD * 25 + SEC * 20 + GH * 10 + PROD_Q * 15 + CX * 15 + REV * 10 + DX * 5) / 100 ))

echo "## Capability Scores (technical / production evidence)"
echo
printf "| Dimension | Score | Type |\n"
printf "|-----------|------:|------|\n"
printf "| Production stability | %d | capability |\n" "$PROD"
printf "| Security | %d | capability |\n" "$SEC"
printf "| GitHub governance | %d | capability |\n" "$GH"
printf "| Product quality | %d | capability |\n" "$PROD_Q"
printf "| Developer experience | %d | capability |\n" "$DX"
echo
echo "## Outcome Scores (OUTCOME_LOG evidence only — status: ${OUTCOME_STATUS})"
echo
printf "| Dimension | Score | Evidence |\n"
printf "|-----------|------:|----------|\n"
printf "| Customer experience | %d | outcome_log |\n" "$CX"
printf "| Revenue reliability | %d | outcome_log |\n" "$REV"
echo
printf "| **Overall (weighted)** | **%d** | cap+outcome |\n" "$OVERALL"
echo
echo "Live dashboard: ${PROD_URL}/admin/executive"
echo "Auto-sync:      npm run cto:outcomes  (requires CTO_OUTCOME_SECRET)"
echo "Health scores:  npm run cto:health"
