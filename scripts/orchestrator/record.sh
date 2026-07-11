#!/usr/bin/env bash
# Record completed iteration — updates state + log
# Usage: npm run cto:orchestrator -- complete <task_id> "<outcome>" [pr_number]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

TASK_ID="${1:-}"
OUTCOME="${2:-}"
PR_NUM="${3:-}"

if [[ -z "$TASK_ID" || -z "$OUTCOME" ]]; then
  echo "Usage: cto-orchestrator complete <task_id> \"<outcome>\" [pr_number]" >&2
  exit 1
fi

STATE="orchestrator/state.json"
LOG="docs/ORCHESTRATOR_LOG.md"
DATE="$(orchestrator_now_iso)"
SHA="$(orchestrator_short_sha)"

# Health snapshot
HEALTH="$(npm run cto:health 2>&1 | grep 'Overall (weighted)' | grep -oE '[0-9]+' | head -1 || echo 0)"

if [[ ! -f "$STATE" ]]; then
  echo '{"version":1,"iteration_count":0}' > "$STATE"
fi

ITER="$(jq -r '.iteration_count // 0' "$STATE")"
NEXT_ITER=$((ITER + 1))
ITER_ID="$(printf 'iter-%03d' "$NEXT_ITER")"

jq \
  --arg id "$ITER_ID" \
  --arg task "$TASK_ID" \
  --arg outcome "$OUTCOME" \
  --arg at "$DATE" \
  --arg sha "$SHA" \
  --arg pr "$PR_NUM" \
  --argjson health "${HEALTH:-0}" \
  --argjson count "$NEXT_ITER" \
  '.iteration_count = $count
   | .last_iteration = {
       id: $id,
       task_id: $task,
       outcome: $outcome,
       completed_at: $at,
       sha: $sha,
       pr: (if $pr == "" then null else $pr end),
       overall_health: $health
     }' "$STATE" > "${STATE}.tmp" && mv "${STATE}.tmp" "$STATE"

# Append log
if [[ ! -f "$LOG" ]]; then
  cat > "$LOG" <<'HDR'
# Orchestrator Iteration Log

Append-only history of autonomous engineering iterations.

| Iteration | Date | Task | Outcome | SHA | Health |
|-----------|------|------|---------|-----|-------:|
HDR
fi

DISPLAY_DATE="$(orchestrator_now)"
PR_LINK=""
[[ -n "$PR_NUM" ]] && PR_LINK="PR #$PR_NUM"

echo "| $ITER_ID | $DISPLAY_DATE | \`$TASK_ID\` | ${OUTCOME}${PR_LINK:+ · $PR_LINK} | \`$SHA\` | $HEALTH |" >> "$LOG"

echo "Recorded $ITER_ID: $TASK_ID — $OUTCOME"
echo "Updated $STATE and $LOG"
