#!/usr/bin/env bash
# CTO Operating System v2 — daily GitHub + production snapshot
# Usage: npm run cto:snapshot
# Paste output into docs/internal/executive/EXECUTIVE_DASHBOARD.md §9 (Daily Snapshot)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
DATE="$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')"
DATE_SHORT="$(TZ=Asia/Taipei date '+%Y-%m-%d')"

echo "═══════════════════════════════════════════════════════════"
echo "  CTO Daily Snapshot — Sunrise Systems"
echo "  $DATE"
echo "═══════════════════════════════════════════════════════════"
echo

# ── Production ──────────────────────────────────────────────
echo "## Production"
if command -v curl >/dev/null 2>&1; then
  VERSION_JSON="$(curl -sf --max-time 15 "${PROD_URL}/api/version" 2>/dev/null || echo '{}')"
  HEALTH_JSON="$(curl -sf --max-time 15 "${PROD_URL}/api/booking-health" 2>/dev/null || echo '{}')"
  PROD_SHA="$(echo "$VERSION_JSON" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | cut -c1-7)"
  HEALTH_OK="$(echo "$HEALTH_JSON" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true' && echo "ok" || echo "fail")"
  echo "  URL:      $PROD_URL"
  echo "  SHA:      ${PROD_SHA:-unknown}"
  echo "  Health:   ${HEALTH_OK}"
else
  echo "  (curl not available)"
  PROD_SHA="unknown"
fi

LOCAL_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "  main:     $LOCAL_SHA"
if [[ "$PROD_SHA" != "unknown" && "$LOCAL_SHA" != "unknown" && "$PROD_SHA" != "$LOCAL_SHA" ]]; then
  echo "  ⚠️  Production SHA differs from local main"
fi
echo

# ── Tests ───────────────────────────────────────────────────
echo "## Tests"
if [[ -f package.json ]] && command -v npm >/dev/null 2>&1; then
  TEST_OUT="$(npm test 2>&1)" || true
  TEST_COUNT="$(echo "$TEST_OUT" | sed -n 's/.*Tests[[:space:]]*\([0-9]*\) passed.*/\1/p' | tail -1)"
  TEST_STATUS="$(echo "$TEST_OUT" | grep -q "Tests.*passed" && echo "green" || echo "red")"
  echo "  Count:    ${TEST_COUNT:-?}"
  echo "  Status:   $TEST_STATUS"
else
  TEST_COUNT="?"
  TEST_STATUS="unknown"
fi
echo

# ── GitHub (requires gh) ────────────────────────────────────
if ! command -v gh >/dev/null 2>&1; then
  echo "## GitHub"
  echo "  gh CLI not installed — skip PR/issue/CI snapshot"
  echo
  echo "── Paste block for EXECUTIVE_DASHBOARD.md §9 ──"
  cat <<EOF
\`\`\`
日期：$DATE_SHORT
Production SHA：$PROD_SHA
Open PRs：（gh unavailable）
Open Issues：（gh unavailable）
CI main：unknown
Tests：$TEST_COUNT
Blockers：verify manually
今日最高 ROI：檢查 Business Impact Queue Rank 1
\`\`\`
EOF
  exit 0
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo unknown)"

echo "## GitHub ($REPO)"

# Open PRs
OPEN_PRS="$(gh pr list --state open --limit 50 --json number,title,isDraft,headRefName,updatedAt 2>/dev/null || echo '[]')"
OPEN_PR_COUNT="$(echo "$OPEN_PRS" | jq 'length' 2>/dev/null || echo 0)"
DRAFT_COUNT="$(echo "$OPEN_PRS" | jq '[.[] | select(.isDraft)] | length' 2>/dev/null || echo 0)"
echo "  Open PRs:     $OPEN_PR_COUNT (draft: $DRAFT_COUNT)"
if [[ "$OPEN_PR_COUNT" -gt 0 ]]; then
  echo "$OPEN_PRS" | jq -r '.[] | "    #\(.number) \(if .isDraft then "[DRAFT] " else "" end)\(.title)"' 2>/dev/null || true
fi

# Merged PRs (last 7 days)
MERGED_7D="$(gh pr list --state merged --limit 20 --json number,title,mergedAt 2>/dev/null | jq '[.[] | select(.mergedAt != null)] | length' 2>/dev/null || echo "?")"
echo "  Merged (7d):  $MERGED_7D"

# Issues
OPEN_ISSUES="$(gh issue list --state open --limit 50 --json number,title,labels 2>/dev/null || echo '[]')"
OPEN_ISSUE_COUNT="$(echo "$OPEN_ISSUES" | jq 'length' 2>/dev/null || echo 0)"
echo "  Open Issues:  $OPEN_ISSUE_COUNT"
if [[ "$OPEN_ISSUE_COUNT" -gt 0 ]]; then
  echo "$OPEN_ISSUES" | jq -r '.[] | "    #\(.number) \(.title)"' 2>/dev/null || true
fi

# Branches
REMOTE_BRANCHES="$(git ls-remote --heads origin 2>/dev/null | awk '{print $2}' | sed 's|refs/heads/||' | sort || true)"
BRANCH_COUNT="$(echo "$REMOTE_BRANCHES" | grep -c . 2>/dev/null || true)"
CURSOR_BRANCHES="$(echo "$REMOTE_BRANCHES" | grep '^cursor/' 2>/dev/null | wc -l | tr -d ' ')"
echo "  Branches:     $BRANCH_COUNT remote (cursor/*: $CURSOR_BRANCHES)"

# Releases / tags
LATEST_TAG="$(gh release list --limit 1 --json tagName,publishedAt -q '.[0] | "\(.tagName) (\(.publishedAt))"' 2>/dev/null || git tag --sort=-creatordate | head -1 || echo none)"
echo "  Latest tag:   $LATEST_TAG"

# CI main (last 5)
echo "  CI main (last 5):"
gh run list --branch main --limit 5 --json conclusion,displayTitle,createdAt,url 2>/dev/null \
  | jq -r '.[] | "    \(.conclusion // "pending") — \(.displayTitle) (\(.createdAt | split("T")[0]))"' 2>/dev/null \
  || echo "    (unable to fetch)"
echo

# ── Outcome Pipeline (optional) ─────────────────────────────
SECRET="${CTO_OUTCOME_SECRET:-${CRON_SECRET:-}}"
if [[ -n "$SECRET" ]] && command -v jq >/dev/null 2>&1; then
  echo "## Outcome Pipeline"
  OUTCOME_JSON="$(curl -sf --max-time 20 -H "Authorization: Bearer ${SECRET}" \
    "${PROD_URL}/api/cto/outcomes" 2>/dev/null || echo '{}')"
  O_STATUS="$(echo "$OUTCOME_JSON" | jq -r '.status // "unavailable"' 2>/dev/null)"
  O_DEPOSIT="$(echo "$OUTCOME_JSON" | jq -r '.payment.deposit_rate_pct // "—"' 2>/dev/null)"
  O_WAITLIST="$(echo "$OUTCOME_JSON" | jq -r '.waitlist.conversion_pct // "—"' 2>/dev/null)"
  O_PENDING="$(echo "$OUTCOME_JSON" | jq -r '.payment.pending_reviews // "—"' 2>/dev/null)"
  echo "  Status:       $O_STATUS"
  echo "  訂金率(30d):  ${O_DEPOSIT}%"
  echo "  候補轉換:     ${O_WAITLIST}%"
  echo "  待審核:       $O_PENDING"
  echo "  Dashboard:    ${PROD_URL}/admin/executive"
  echo
fi

# ── Blockers heuristic ──────────────────────────────────────
BLOCKERS=()
[[ "$DRAFT_COUNT" -gt 0 ]] && BLOCKERS+=("${DRAFT_COUNT} draft PR(s) should close")
[[ "$PROD_SHA" != "$LOCAL_SHA" && "$PROD_SHA" != "unknown" ]] && BLOCKERS+=("prod/main SHA mismatch")
if [[ ${#BLOCKERS[@]} -eq 0 ]]; then
  BLOCKER_TEXT="none detected"
else
  BLOCKER_TEXT="$(IFS='; '; echo "${BLOCKERS[*]}")"
fi

# ── Paste block ─────────────────────────────────────────────
echo "── Paste block for EXECUTIVE_DASHBOARD.md §9 ──"
cat <<EOF
\`\`\`
日期：$DATE_SHORT
Production SHA：$PROD_SHA
Open PRs：$OPEN_PR_COUNT（draft $DRAFT_COUNT）
Open Issues：$OPEN_ISSUE_COUNT
CI main：${TEST_STATUS/green/green}
Tests：$TEST_COUNT
Blockers：$BLOCKER_TEXT
今日最高 ROI：見 Business Impact Queue Rank 1
\`\`\`
EOF

echo
echo "Next: update docs/internal/executive/EXECUTIVE_DASHBOARD.md §5–§9 with snapshot data."
