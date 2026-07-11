#!/usr/bin/env bash
# Score tasks from catalog and select next highest-impact work
# Output: orchestrator/priority.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

DISCOVER_FILE="orchestrator/discover.env"
CATALOG="orchestrator/task-catalog.json"
OUT="orchestrator/priority.json"

[[ -f "$DISCOVER_FILE" ]] || {
  bash "$SCRIPT_DIR/discover.sh" >/dev/null
}

# shellcheck disable=SC1090
source "$DISCOVER_FILE"

GATE_BLOCK=0
[[ "$GATE_STATUS" == "BLOCK" ]] && GATE_BLOCK=1

# Build scored task list
jq -n \
  --argjson catalog "$(cat "$CATALOG")" \
  --argjson gate_block "$GATE_BLOCK" \
  --argjson bot_can_close "$BOT_CAN_CLOSE" \
  --argjson drift_failures "$DOC_DRIFT_FAILURES" \
  --argjson drift_warnings "$DOC_DRIFT_WARNINGS" \
  --argjson cursor_branches "$GITHUB_CURSOR_BRANCHES" \
  --argjson outcome_measured "$OUTCOME_MEASURED" \
  --argjson orch_shipped "${ORCH_SHIPPED:-0}" \
  --arg last_task "$LAST_TASK_ID" \
  '
  def score_task($t):
    (if $t.independent == true then 1 else 0 end) as $ind |
    (if ($t.owner // "agent") == "agent" then 1 else 0 end) as $agent |
    (if ($t.requires_gate_pass // false) == true and $gate_block == 1 then 0 else 1 end) as $gate_ok |
    (if ($t.requires_permission // "") == "github_write" and $bot_can_close == 0 then 0 else 1 end) as $perm_ok |
    (if $t.id == "doc-drift-fix" and ($drift_failures + $drift_warnings) == 0 then 0 else 1 end) as $drift_needed |
    (if $t.id == "branch-hygiene" and $cursor_branches <= 2 then 0 else 1 end) as $branch_needed |
    (if $t.id == "outcome-baseline" and $outcome_measured == 1 then 0 else 1 end) as $outcome_needed |
    (if $t.id == $last_task and $last_task != "" then 0 else 1 end) as $not_repeat |
    (if $t.id == "orch-os-evolve" and $orch_shipped == 1 then 0 else 1 end) as $orch_needed |
    ($t.base_score // 50)
    + (if $gate_block == 1 then ($t.gate_block_bonus // 0) else 0 end)
    + (if $t.id == "doc-drift-fix" then ($drift_failures * 20 + $drift_warnings * 5) else 0 end)
    | . as $s |
    {
      id: $t.id,
      title: $t.title,
      role: $t.role,
      type: $t.type,
      owner: ($t.owner // "agent"),
      score: (if ($ind * $agent * $gate_ok * $perm_ok * $drift_needed * $branch_needed * $outcome_needed * $not_repeat * $orch_needed) == 0 then 0 else $s end),
      executable: (($ind * $agent * $gate_ok * $perm_ok * $drift_needed * $branch_needed * $outcome_needed * $not_repeat * $orch_needed) == 1),
      blocked_reason: (
        if $perm_ok == 0 then "requires_permission:github_write"
        elif $gate_ok == 0 then "requires_gate_pass"
        elif $agent == 0 then "owner:founder"
        elif $drift_needed == 0 then "no_drift"
        elif $branch_needed == 0 then "branches_clean"
        elif $outcome_needed == 0 then "outcome_already_measured"
        elif $not_repeat == 0 then "completed_last_iteration"
        elif $orch_needed == 0 then "orchestrator_v1_shipped"
        else null end
      ),
      evidence: $t.evidence,
      verify: $t.verify
    };

  ($catalog.tasks | map(score_task(.)) | sort_by(-.score)) as $ranked |
  ($ranked | map(select(.executable == true)) | .[0] // null) as $next |
  ($ranked | map(select(.executable == false and .score > 0)) | .[0:3]) as $blocked |
  {
    generated_at: now | strftime("%Y-%m-%dT%H:%M:%SZ"),
    gate_block: ($gate_block == 1),
    ranked: $ranked,
    next_task: $next,
    top_blocked: $blocked
  }
  ' > "$OUT"

echo "## Orchestrator Prioritize"
echo
NEXT_ID="$(jq -r '.next_task.id // "none"' "$OUT")"
NEXT_SCORE="$(jq -r '.next_task.score // 0' "$OUT")"
NEXT_OWNER="$(jq -r '.next_task.owner // "none"' "$OUT")"
echo "**Selected:** \`$NEXT_ID\` (score $NEXT_SCORE, owner $NEXT_OWNER)"
echo
echo "Wrote \`$OUT\`"
