#!/usr/bin/env bash
# Stall detection — surface loop stagnation (AI-company deadlock pattern)
# Output: orchestrator/stall.json
# Exit: 0=ok | 1=stalled (warnings present)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

STATE="orchestrator/state.json"
EVIDENCE="orchestrator/autonomy-evidence.jsonl"
LEASE="orchestrator/lease.json"
OUT="orchestrator/stall.json"
NOW_EPOCH="$(date +%s)"
WARNINGS='[]'
STALLED=0

add_warning() {
  local code="$1"
  local msg="$2"
  WARNINGS="$(echo "$WARNINGS" | jq --arg c "$code" --arg m "$msg" '. + [{code: $c, message: $m}]')"
  STALLED=1
}

# No iteration in 72h while ACTIVE_LOOP
if [[ -f "$STATE" ]]; then
  MODE="$(jq -r '.operational_mode // ""' "$STATE")"
  LAST_AT="$(jq -r '.last_iteration.completed_at // ""' "$STATE")"
  if [[ "$MODE" == "ACTIVE_LOOP" && -n "$LAST_AT" && "$LAST_AT" != "null" ]]; then
    LAST_EPOCH="$(date -d "$LAST_AT" +%s 2>/dev/null || echo 0)"
    GAP=$((NOW_EPOCH - LAST_EPOCH))
    if [[ "$LAST_EPOCH" -gt 0 && "$GAP" -gt 259200 ]]; then
      add_warning "iteration_stale" "No completed iteration in ${GAP}s (>72h) while ACTIVE_LOOP"
    fi
  fi

  # pending_pr stuck >24h
  PENDING_BRANCH="$(jq -r '.pending_pr.branch // ""' "$STATE")"
  if [[ -n "$PENDING_BRANCH" && "$PENDING_BRANCH" != "null" ]]; then
    add_warning "pending_pr" "PR creation blocked — branch $PENDING_BRANCH awaiting resume"
  fi
fi

# Same failure phase repeated 3+ in last 8 evidence lines
if [[ -f "$EVIDENCE" ]]; then
  FAIL_REPEAT="$(tail -8 "$EVIDENCE" | jq -r 'select(.phase | test("fail|blocked|timeout")) | .phase' 2>/dev/null | sort | uniq -c | sort -rn | head -1 || echo "")"
  FCOUNT="$(echo "$FAIL_REPEAT" | awk '{print $1}' 2>/dev/null || echo 0)"
  FPHASE="$(echo "$FAIL_REPEAT" | awk '{print $2}' 2>/dev/null || echo "")"
  if [[ "${FCOUNT:-0}" -ge 3 && -n "$FPHASE" ]]; then
    add_warning "failure_loop" "Phase '$FPHASE' repeated ${FCOUNT}x in last 8 runs — switch to independent task"
  fi
fi

# Expired lease file not cleaned
if [[ -f "$LEASE" ]]; then
  EXPIRES="$(jq -r '.expires_epoch // 0' "$LEASE")"
  if [[ "$EXPIRES" -le "$NOW_EPOCH" ]]; then
    HOLDER="$(jq -r '.holder // ""' "$LEASE")"
    add_warning "lease_expired" "Stale lease file for $HOLDER — safe to remove orchestrator/lease.json"
  fi
fi

jq -n \
  --arg ts "$(orchestrator_now_iso)" \
  --argjson stalled "$STALLED" \
  --argjson warnings "$WARNINGS" \
  '{checked_at: $ts, stalled: ($stalled == 1), warnings: $warnings}' > "$OUT"

if [[ "$STALLED" -eq 1 ]]; then
  echo "stall-check: STALLED ($(echo "$WARNINGS" | jq 'length')) warnings"
  exit 1
fi
echo "stall-check: ok"
exit 0
