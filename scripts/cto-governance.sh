#!/usr/bin/env bash
# Engineering governance gate — repository health before feature work
# Usage: npm run cto:governance
# Exit 0 = healthy enough for features | Exit 2 = governance iteration required

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DATE="$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')"
DATE_SHORT="$(TZ=Asia/Taipei date '+%Y-%m-%d')"
STATUS_FILE="docs/internal/governance/GOVERNANCE_STATUS.md"
FOUNDER_FILE="docs/internal/governance/FOUNDER_ACTION_LIST.md"
TRIAGE_FILE="docs/internal/governance/GITHUB_TRIAGE.md"

GATE_FAIL=0
REASONS=()

add_reason() { REASONS+=("$1"); GATE_FAIL=1; }

echo "═══════════════════════════════════════════════════════════"
echo "  Engineering Governance Gate"
echo "  $DATE"
echo "═══════════════════════════════════════════════════════════"
echo

# ── Health scores ───────────────────────────────────────────
HEALTH_OUT="$(npm run cto:health 2>&1)" || true
echo "$HEALTH_OUT"
echo

OVERALL="$(echo "$HEALTH_OUT" | grep 'Overall (weighted)' | grep -oE '[0-9]+' | head -1)"
GH_SCORE="$(echo "$HEALTH_OUT" | grep 'GitHub governance' | awk -F'|' '{gsub(/ /,"",$3); print $3}' | head -1)"
PROD_SCORE="$(echo "$HEALTH_OUT" | grep 'Production stability' | awk -F'|' '{gsub(/ /,"",$3); print $3}' | head -1)"
OVERALL="${OVERALL:-0}"
GH_SCORE="${GH_SCORE:-0}"
PROD_SCORE="${PROD_SCORE:-0}"

[[ "$OVERALL" -lt 70 ]] && add_reason "Overall health $OVERALL < 70"
[[ "$GH_SCORE" -lt 60 ]] && add_reason "GitHub governance $GH_SCORE < 60"
[[ "$PROD_SCORE" -lt 50 ]] && add_reason "Production stability $PROD_SCORE < 50"

# ── GitHub hygiene ──────────────────────────────────────────
HYGIENE_OUT="$(bash scripts/cto-github-hygiene.sh 2>&1)" || true
eval "$(echo "$HYGIENE_OUT" | grep -E '^GITHUB_' || true)"

ISSUE_COUNT="${GITHUB_ISSUE_COUNT:-0}"
PR_COUNT="${GITHUB_PR_COUNT:-0}"
DRAFT_COUNT="${GITHUB_DRAFT_COUNT:-0}"
NON_DEP="${GITHUB_NON_DEP_PR_COUNT:-0}"
CURSOR_BRANCHES="${GITHUB_CURSOR_BRANCH_COUNT:-0}"
BOT_CAN_CLOSE="${GITHUB_BOT_CAN_CLOSE:-0}"

[[ "$NON_DEP" -gt 3 ]] && add_reason "Non-dependabot open PRs: $NON_DEP > 3"
[[ "$DRAFT_COUNT" -gt 0 ]] && add_reason "Draft PRs: $DRAFT_COUNT (phase ghosts should be closed)"
[[ "$CURSOR_BRANCHES" -gt 2 ]] && add_reason "cursor/* branches: $CURSOR_BRANCHES > 2"

# ── Doc drift ───────────────────────────────────────────────
DRIFT_OUT="$(bash scripts/cto-doc-drift.sh 2>&1)" || DRIFT_EXIT=$?
DRIFT_EXIT="${DRIFT_EXIT:-0}"
DRIFT_FAILURES="$(echo "$DRIFT_OUT" | sed -n 's/DOC_DRIFT_FAILURES=\([0-9]*\)/\1/p')"
DRIFT_FAILURES="${DRIFT_FAILURES:-0}"
[[ "$DRIFT_FAILURES" -gt 0 ]] && add_reason "Documentation drift failures: $DRIFT_FAILURES"

echo "$DRIFT_OUT"
echo

# ── Gate verdict ────────────────────────────────────────────
if [[ "$GATE_FAIL" -eq 0 ]]; then
  GATE_STATUS="PASS"
  GATE_VERDICT="✅ Repository healthy — feature development may proceed"
  EXIT_CODE=0
else
  GATE_STATUS="BLOCK"
  GATE_VERDICT="🛑 Governance iteration required before feature work"
  EXIT_CODE=2
fi

echo "═══════════════════════════════════════════════════════════"
echo "  Gate: $GATE_STATUS"
echo "  $GATE_VERDICT"
if [[ ${#REASONS[@]} -gt 0 ]]; then
  echo "  Reasons:"
  for r in "${REASONS[@]}"; do echo "    - $r"; done
fi
echo "═══════════════════════════════════════════════════════════"

# ── Write GOVERNANCE_STATUS.md ──────────────────────────────
LOCAL_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat > "$STATUS_FILE" <<EOF
# Governance Status (auto-generated)

**Last run:** $DATE  
**Gate:** $GATE_STATUS  
**main:** \`$LOCAL_SHA\`

> Regenerate: \`npm run cto:governance\`  
> Policy: [\`ENGINEERING_GOVERNANCE.md\`](./ENGINEERING_GOVERNANCE.md)

---

## Scores

| Metric | Value | Threshold |
|--------|------:|-----------|
| Overall health | $OVERALL | ≥ 70 |
| GitHub governance | $GH_SCORE | ≥ 60 |
| Production stability | $PROD_SCORE | ≥ 50 |
| Open issues | $ISSUE_COUNT | triage weekly |
| Open PRs (non-dep) | $NON_DEP | ≤ 3 |
| Draft PRs | $DRAFT_COUNT | 0 |
| cursor/* branches | $CURSOR_BRANCHES | ≤ 2 |
| Doc drift failures | $DRIFT_FAILURES | 0 |

## Gate verdict

$GATE_VERDICT

$(if [[ ${#REASONS[@]} -gt 0 ]]; then
  echo "### Blocking reasons"
  for r in "${REASONS[@]}"; do echo "- $r"; done
fi)

## Next actions

| Priority | Action | Owner |
|----------|--------|-------|
| 1 | Execute [\`FOUNDER_ACTION_LIST.md\`](./FOUNDER_ACTION_LIST.md) if bot blocked | Founder |
| 2 | Update [\`GITHUB_TRIAGE.md\`](./GITHUB_TRIAGE.md) after closes | CTO / Founder |
| 3 | Fix doc drift warnings in IMPLEMENTATION_TRUTH | CTO Agent |
| 4 | Re-run \`npm run cto:governance\` until PASS | CTO Agent |

---

_See hygiene detail in CI artifact or run \`bash scripts/cto-github-hygiene.sh\`_
EOF

# ── Write FOUNDER_ACTION_LIST.md (dynamic snapshot only) ─────
# SSOT for what Founder must grant: docs/FOUNDER_PERMISSIONS.md
cat > "$FOUNDER_FILE" <<EOF
# Founder Action List

**Updated:** $DATE  
**Gate:** $GATE_STATUS · Overall **${OVERALL:-?}** / 100  
**SSOT:** [\`FOUNDER_PERMISSIONS.md\`](./FOUNDER_PERMISSIONS.md) — 權限與 secret 清單（目標分數 100）

---

## 目前阻塞（自動偵測）

| 項目 | 現況 | 解法 |
|------|------|------|
| Production SHA | \`$LOCAL_SHA\` vs prod — see drift check | Founder: \`vercel deploy --prod\` 或提供 \`VERCEL_TOKEN\` |
| OUTCOME_LOG | $(grep -q 'date: null' docs/internal/executive/OUTCOME_LOG.md 2>/dev/null && echo '未測量' || echo '已填') | 設定 \`CTO_OUTCOME_SECRET\` → 自動同步；或手動開 Executive 儀表板 |
| DB migrations | 3 pending | [\`OPS_MIGRATION_RUNBOOK.md\`](./OPS_MIGRATION_RUNBOOK.md) |
| Open issues | $ISSUE_COUNT | 策略性保留 #53/#54/#95/#99；#61/#63 已登記 CAPABILITY_GAPS |

## GitHub 狀態（本輪）

| 指標 | 值 |
|------|---:|
| Open PRs (non-dep) | $NON_DEP |
| Draft PRs | $DRAFT_COUNT |
| cursor/* branches | $CURSOR_BRANCHES |
| Bot can close issues | $( [[ "$BOT_CAN_CLOSE" == 1 ]] && echo 'yes' || echo 'no — use github-hygiene workflow' ) |

## 一鍵指令

\`\`\`bash
# 關閉已 triage 的 issue（若 workflow 未跑）
gh workflow run github-hygiene.yml

# 治理重算
npm run cto:governance
npm run cto:health
\`\`\`

---

_完整權限清單與「開了能加幾分」見 [\`FOUNDER_PERMISSIONS.md\`](./FOUNDER_PERMISSIONS.md)._
EOF

# ── Update GITHUB_TRIAGE.md snapshot ────────────────────────
cat > "$TRIAGE_FILE" <<EOF
# GitHub Triage Registry

**Updated:** $DATE  
**Gate:** $GATE_STATUS

Curated issue/PR actions. Bot cannot close — Founder executes [\`FOUNDER_ACTION_LIST.md\`](./FOUNDER_ACTION_LIST.md).

---

## Issues

| # | Title | Action | Status |
|--:|-------|--------|--------|
| 53 | Payment flow optimization | **KEEP** P1 | open — needs OUTCOME_LOG |
| 54 | Production Excellence epic | **KEEP** epic | open |
| 61 | AI workflow docs | **DEFER** P3 | open — tracked in CAPABILITY_GAPS |
| 63 | PaymentProvider abstraction | **DEFER** P3 | open — no gateway contract |
| 95 | Founder ops batch | **KEEP** P0 | open — migrations + secrets |
| 99 | Integrated deposit capture | **KEEP** strategic | open |

## Pull requests

_All triaged PRs closed 2026-07-11. Non-dependabot open: ${NON_DEP:-0}._

## Branches

Remote should be: \`main\` only (+ short-lived \`cursor/*\` during agent runs).  
Delete merged \`cursor/*\` after PR merge.

---

$(echo "$HYGIENE_OUT" | sed -n '/^## GitHub Hygiene/,/^GITHUB_/p' | head -n -1)
EOF

exit "$EXIT_CODE"
