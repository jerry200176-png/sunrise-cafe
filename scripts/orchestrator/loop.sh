#!/usr/bin/env bash
# Autonomous engineering loop — one bounded iteration
# Usage:
#   bash scripts/orchestrator/loop.sh run
#   bash scripts/orchestrator/loop.sh canary
#   bash scripts/orchestrator/loop.sh resume
#
# Exit: 0=success/idle | 2=blocked | 3=lease held | 4=validation fail

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

MODE="${1:-run}"
RUN_ID="${GITHUB_RUN_ID:-local-$(date +%s)}"
STATE="orchestrator/state.json"
EVIDENCE="$SCRIPT_DIR/evidence.sh"
MAX_CI_WAIT="${MAX_CI_WAIT_SEC:-1200}"
DEPLOY_WAIT_SEC="${DEPLOY_WAIT_SEC:-600}"

log() { echo "[loop:$RUN_ID] $*"; }

poll_and_merge_pr() {
  local pr="$1"
  local elapsed=0
  while [[ "$elapsed" -lt "$MAX_CI_WAIT" ]]; do
    if gh pr checks "$pr" 2>/dev/null | grep -E 'Lint & Build.*fail|Playwright.*fail' | grep -q fail; then
      log "CI failed on PR #$pr"
      bash "$EVIDENCE" ci_fail "{\"pr\":$pr}"
      return 1
    fi
    if gh pr checks "$pr" 2>/dev/null | grep 'Lint & Build' | grep -q pass && \
       gh pr checks "$pr" 2>/dev/null | grep 'Playwright' | grep -q pass; then
      log "CI green — merging #$pr"
      if gh pr merge "$pr" --squash --delete-branch; then
        bash "$EVIDENCE" merged "{\"pr\":$pr}"
        git checkout main 2>/dev/null || true
        git pull origin main
        return 0
      fi
      return 1
    fi
    sleep 30
    elapsed=$((elapsed + 30))
  done
  log "CI timeout PR #$pr"
  bash "$EVIDENCE" ci_timeout "{\"pr\":$pr}"
  return 1
}

finalize_iteration() {
  local task="$1"
  local pr="$2"
  if bash "$SCRIPT_DIR/deploy-gate.sh" --wait "$DEPLOY_WAIT_SEC" 2>/dev/null; then
    bash "$EVIDENCE" production_verified "{\"pr\":$pr}"
  else
    bash "$EVIDENCE" production_blocked "{\"pr\":$pr,\"note\":\"external_deploy\"}"
  fi
  npm run cto:orchestrator -- complete "$task" "autonomous loop PR #$pr" "$pr" || true
  jq 'del(.active_pr)' "$STATE" > "${STATE}.tmp" && mv "${STATE}.tmp" "$STATE"
  bash "$EVIDENCE" complete "{\"task\":\"$task\",\"pr\":$pr}"
  log "Iteration complete: $task PR #$pr"
}

cleanup() {
  bash "$SCRIPT_DIR/lease.sh" release "$RUN_ID" 2>/dev/null || true
}
trap cleanup EXIT

# ── 1. Wake ─────────────────────────────────────────────────
bash "$EVIDENCE" wake "{\"mode\":\"$MODE\"}"
log "Wake mode=$MODE"

# ── 2. Deploy gate ──────────────────────────────────────────
DEPLOY_MODE="STANDBY"
if bash "$SCRIPT_DIR/deploy-gate.sh" 2>/dev/null; then
  DEPLOY_MODE="LIVE"
fi
bash "$EVIDENCE" deploy_gate "{\"mode\":\"$DEPLOY_MODE\"}"
log "Deploy gate: $DEPLOY_MODE"

# ── 3. Lease ────────────────────────────────────────────────
if ! bash "$SCRIPT_DIR/lease.sh" acquire "$RUN_ID"; then
  bash "$EVIDENCE" lease_denied "{}"
  exit 3
fi
bash "$EVIDENCE" lease_acquired "{\"holder\":\"$RUN_ID\"}"

# ── 4. Resume active PR ─────────────────────────────────────
if [[ "$MODE" == "resume" ]] || jq -e '.active_pr.number' "$STATE" >/dev/null 2>&1; then
  PR_NUM="$(jq -r '.active_pr.number // empty' "$STATE")"
  if [[ -n "$PR_NUM" ]]; then
    log "Resuming PR #$PR_NUM"
    bash "$EVIDENCE" resume_pr "{\"pr\":$PR_NUM}"
    if poll_and_merge_pr "$PR_NUM"; then
      TASK_ID="$(jq -r '.active_pr.task_id // "unknown"' "$STATE")"
      finalize_iteration "$TASK_ID" "$PR_NUM"
      exit 0
    fi
    exit 2
  fi
fi

# ── 5. Select task ──────────────────────────────────────────
npm run cto:orchestrator >/dev/null
TASK="$(jq -r '.next_task.id // empty' orchestrator/priority.json)"
[[ "$MODE" == "canary" ]] && TASK="autonomy-canary"
[[ "$MODE" == "canary" ]] && export LOOP_BOOTSTRAP=1
if [[ -z "$TASK" || "$TASK" == "null" ]]; then
  bash "$EVIDENCE" idle "{\"reason\":\"no_executable_task\"}"
  log "No executable task — idle"
  exit 0
fi
bash "$EVIDENCE" task_selected "{\"task_id\":\"$TASK\"}"
log "Task: $TASK"

# ── 6. Execute ──────────────────────────────────────────────
bash "$SCRIPT_DIR/execute.sh" "$TASK"
bash "$EVIDENCE" executed "{\"task_id\":\"$TASK\"}"

# ── 7. Validate ───────────────────────────────────────────
if ! npm test >/dev/null 2>&1; then
  bash "$EVIDENCE" validation_fail "{\"step\":\"test\"}"
  exit 4
fi
npm run verify:migrations >/dev/null 2>&1 || true
npm run lint >/dev/null 2>&1 || true
bash "$EVIDENCE" validated "{\"tests\":\"pass\"}"

# ── 8. Branch + commit ────────────────────────────────────
SHA_SHORT="$(orchestrator_short_sha)"
BRANCH="cursor/auto-${TASK}-${SHA_SHORT}-3a90"
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
git add -A
if git diff --cached --quiet; then
  bash "$EVIDENCE" no_changes "{\"task\":\"$TASK\"}"
  log "No changes to commit"
  exit 0
fi
git commit -m "auto(${TASK}): autonomous loop iteration

Run: ${RUN_ID}
Deploy mode: ${DEPLOY_MODE}"

bash "$SCRIPT_DIR/review.sh" "origin/main" || { bash "$EVIDENCE" review_fail "{}"; exit 4; }
bash "$EVIDENCE" review_pass "{}"

git push -u origin "$BRANCH" --force-with-lease
bash "$EVIDENCE" pushed "{\"branch\":\"$BRANCH\"}"

# ── 9. PR ───────────────────────────────────────────────────
PR_BODY="Autonomous loop iteration. Task: ${TASK}. Run: ${RUN_ID}. Deploy mode: ${DEPLOY_MODE}."
PR_URL="$(gh pr create --base main --head "$BRANCH" \
  --title "auto(${TASK}): autonomous loop ${SHA_SHORT}" \
  --body "$PR_BODY")"
PR_NUM="$(echo "$PR_URL" | grep -oE '[0-9]+$')"
bash "$EVIDENCE" pr_created "{\"pr\":$PR_NUM,\"branch\":\"$BRANCH\"}"
log "PR #$PR_NUM"

jq --argjson pr "$PR_NUM" --arg branch "$BRANCH" --arg task "$TASK" --arg run "$RUN_ID" \
  '.active_pr = {number: $pr, branch: $branch, task_id: $task, run_id: $run}' \
  "$STATE" > "${STATE}.tmp" && mv "${STATE}.tmp" "$STATE"
git add "$STATE" orchestrator/autonomy-evidence.jsonl orchestrator/canary-marker.json 2>/dev/null || git add "$STATE"
git commit -m "auto: record active PR #$PR_NUM" --allow-empty 2>/dev/null || git commit -m "auto: record active PR #$PR_NUM" || true
git push 2>/dev/null || true

# ── 10. Merge + finalize ────────────────────────────────────
if poll_and_merge_pr "$PR_NUM"; then
  finalize_iteration "$TASK" "$PR_NUM"
  exit 0
fi
exit 2
