#!/usr/bin/env bash
# GitHub hygiene audit — issues, PRs, branches, Founder blockers
# Usage: bash scripts/cto-github-hygiene.sh
# Called by: npm run cto:governance

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DATE="$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')"
CAN_CLOSE=1

echo "## GitHub Hygiene Audit"
echo "_Generated: $DATE"
echo

if ! command -v gh >/dev/null 2>&1; then
  echo "⚠️ \`gh\` CLI unavailable — skip GitHub hygiene"
  exit 0
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo unknown)"
echo "**Repository:** $REPO"
echo

# ── Issues ──────────────────────────────────────────────────
OPEN_ISSUES="$(gh issue list --state open --limit 50 --json number,title,labels,updatedAt 2>/dev/null || echo '[]')"
ISSUE_COUNT="$(echo "$OPEN_ISSUES" | jq 'length' 2>/dev/null || echo 0)"
echo "### Open Issues ($ISSUE_COUNT)"
echo
echo "| # | Title | Recommended action | Evidence |"
echo "|--:|-------|-------------------|----------|"

declare -A ISSUE_ACTION
ISSUE_ACTION[59]="CLOSE — shipped #97/#118 E2E (github-hygiene workflow)"
ISSUE_ACTION[62]="CLOSE — duplicate; reconcile MVP on main (github-hygiene workflow)"
ISSUE_ACTION[60]="CLOSE — webhook observability shipped #118 (github-hygiene workflow)"
ISSUE_ACTION[54]="KEEP epic — defer; child items tracked separately"
ISSUE_ACTION[53]="KEEP P1 — payment flow; needs OUTCOME_LOG first"
ISSUE_ACTION[61]="DEFER P3 — Work Gate weak (DX only)"
ISSUE_ACTION[63]="DEFER P3 — no gateway contract"
ISSUE_ACTION[95]="KEEP — Founder ops batch (migrations)"
ISSUE_ACTION[99]="KEEP — strategic; evidence-based #99"

if [[ "$ISSUE_COUNT" -gt 0 ]]; then
  echo "$OPEN_ISSUES" | jq -r '.[] | "\(.number)|\(.title)"' 2>/dev/null | while IFS='|' read -r num title; do
    action="${ISSUE_ACTION[$num]:-REVIEW — assign P0–P3 via Work Gate}"
    echo "| $num | ${title:0:50} | $action | |"
  done || true
fi
echo

# ── Pull requests ───────────────────────────────────────────
OPEN_PRS="$(gh pr list --state open --limit 50 --json number,title,isDraft,headRefName,updatedAt 2>/dev/null || echo '[]')"
PR_COUNT="$(echo "$OPEN_PRS" | jq 'length' 2>/dev/null || echo 0)"
DRAFT_COUNT="$(echo "$OPEN_PRS" | jq '[.[] | select(.isDraft)] | length' 2>/dev/null || echo 0)"
NON_DEP=$((PR_COUNT - $(echo "$OPEN_PRS" | jq '[.[] | select(.headRefName | startswith("dependabot"))] | length' 2>/dev/null || echo 0)))

echo "### Open Pull Requests ($PR_COUNT, draft: $DRAFT_COUNT, non-dependabot: $NON_DEP)"
echo
echo "| # | Branch | Action | Reason |"
echo "|--:|--------|--------|--------|"

if [[ "$PR_COUNT" -gt 0 ]]; then
  echo "$OPEN_PRS" | jq -r '.[] | "\(.number)|\(.headRefName)|\(.isDraft)|\(.title)"' 2>/dev/null | while IFS='|' read -r num branch draft title; do
    if [[ "$branch" == dependabot/* ]]; then
      if [[ "$branch" == *production* ]]; then
        echo "| $num | $branch | **CLOSE** | Major bumps (lucide 1.x, types 26) — DL-012 |"
      else
        echo "| $num | $branch | REVIEW | Dev deps only; patch minors if CI green |"
      fi
    elif [[ "$draft" == "true" ]] || [[ "$branch" == cursor/phase* ]] || [[ "$num" -le 77 ]]; then
      echo "| $num | $branch | **CLOSE** | Superseded ghost/phase draft; content on main |"
    else
      echo "| $num | $branch | REVIEW | Verify CI + Work Gate |"
    fi
  done || true
fi
echo

# ── Branches ────────────────────────────────────────────────
REMOTE_BRANCHES="$(git ls-remote --heads origin 2>/dev/null | awk '{print $2}' | sed 's|refs/heads/||' | sort || true)"
CURSOR_COUNT="$(echo "$REMOTE_BRANCHES" | awk -F/ '$1=="cursor"{n++} END{print n+0}')"
BRANCH_TOTAL="$(echo "$REMOTE_BRANCHES" | awk 'NF{n++} END{print n+0}')"

echo "### Remote branches ($BRANCH_TOTAL total, cursor/*: $CURSOR_COUNT)"
echo
echo '```'
echo "$REMOTE_BRANCHES" | head -20
echo '```'
echo

STALE_CURSOR="$(echo "$REMOTE_BRANCHES" | grep '^cursor/' || true)"
if [[ -n "$STALE_CURSOR" ]]; then
  echo "**Stale cursor branches (delete if PR merged):**"
  echo "$STALE_CURSOR" | while read -r b; do
    echo "- \`git push origin --delete $b\`"
  done || true
  echo
fi

# ── Permission probe ────────────────────────────────────────
echo "### Bot permissions"
# Use a real open issue; fake IDs return "Could not resolve" (not a permission signal)
PROBE_ISSUE="$(echo "$OPEN_ISSUES" | jq -r '.[0].number // empty' 2>/dev/null)"
if [[ -z "$PROBE_ISSUE" ]]; then
  CAN_CLOSE=1
  echo "ℹ️ No open issues — skip permission probe"
elif CLOSE_ERR="$(gh issue close "$PROBE_ISSUE" --repo "$REPO" 2>&1)"; then
  CAN_CLOSE=1
  echo "✅ Bot closed issue #$PROBE_ISSUE (reopen if unintended)"
  gh issue reopen "$PROBE_ISSUE" --repo "$REPO" 2>/dev/null || true
else
  if echo "$CLOSE_ERR" | grep -qi "not accessible by integration"; then
    CAN_CLOSE=0
    echo "❌ Bot **cannot** close issues/PRs — Founder must execute triage in [\`FOUNDER_ACTION_LIST.md\`](./FOUNDER_ACTION_LIST.md)"
  else
    CAN_CLOSE=1
    echo "⚠️ Close probe failed for #$PROBE_ISSUE: ${CLOSE_ERR:0:80}"
  fi
fi
echo

# Export for parent script
echo "GITHUB_ISSUE_COUNT=$ISSUE_COUNT"
echo "GITHUB_PR_COUNT=$PR_COUNT"
echo "GITHUB_DRAFT_COUNT=$DRAFT_COUNT"
echo "GITHUB_NON_DEP_PR_COUNT=$NON_DEP"
echo "GITHUB_CURSOR_BRANCH_COUNT=$CURSOR_COUNT"
echo "GITHUB_BOT_CAN_CLOSE=$CAN_CLOSE"
