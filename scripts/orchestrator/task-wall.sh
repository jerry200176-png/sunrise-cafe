#!/usr/bin/env bash
# Task wall — unified view of ranked work (inspired by AI-company taskwall_view)
# Output: orchestrator/task-wall.json
# Usage: bash scripts/orchestrator/task-wall.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

PRIORITY="orchestrator/priority.json"
STATE="orchestrator/state.json"
STALL="orchestrator/stall.json"
LEARNINGS="orchestrator/failure-learnings.jsonl"
OUT="orchestrator/task-wall.json"

[[ -f "$PRIORITY" ]] || bash "$SCRIPT_DIR/prioritize.sh" >/dev/null
bash "$SCRIPT_DIR/stall-check.sh" >/dev/null 2>&1 || true

jq -n \
  --slurpfile priority "$PRIORITY" \
  --slurpfile state "$STATE" \
  --slurpfile stall "${STALL:-/dev/null}" \
  --arg ts "$(orchestrator_now_iso)" \
  '
  ($priority[0] // {}) as $p |
  ($state[0] // {}) as $s |
  ($stall[0] // {stalled: false, warnings: []}) as $st |
  {
    generated_at: $ts,
    source: "sunrise-orchestrator",
    reference: "AI-company task_wall pattern (lightweight port)",
    next_task: ($p.next_task // null),
    ranked_executable: ($p.ranked // [] | map(select(.executable == true)) | .[0:8]),
    top_blocked: ($p.top_blocked // []),
    gate_block: ($p.gate_block // false),
    state: {
      iteration_count: ($s.iteration_count // 0),
      operational_mode: ($s.operational_mode // "UNKNOWN"),
      current_task: ($s.current_task // null),
      last_iteration: ($s.last_iteration // null),
      blockers: ($s.blockers // []),
      deploy: ($s.deploy // null)
    },
    stall: $st,
    recent_learnings: []
  }
  ' > "$OUT"

# Attach last 5 failure learnings if present
if [[ -f "$LEARNINGS" ]]; then
  RECENT="$(tail -5 "$LEARNINGS" | jq -s '.' 2>/dev/null || echo '[]')"
  jq --argjson learnings "$RECENT" '.recent_learnings = $learnings' "$OUT" > "${OUT}.tmp" && mv "${OUT}.tmp" "$OUT"
fi

echo "Wrote $OUT"
jq -r '"Task wall: next=" + (.next_task.id // "idle") + " stall=" + (.stall.stalled | tostring)' "$OUT"
