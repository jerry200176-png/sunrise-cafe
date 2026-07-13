#!/usr/bin/env bash
# Dynamic work discovery — tracked + untracked signals
# Output: orchestrator/discovered-work.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

OUT="orchestrator/discovered-work.json"
ITEMS="[]"

add_item() {
  local id="$1" title="$2" source="$3" score="$4" novel="${5:-false}" prompt="${6:-}"
  ITEMS="$(echo "$ITEMS" | jq --arg id "$id" --arg title "$title" --arg source "$source" \
    --argjson score "$score" --argjson novel "$novel" --arg prompt "$prompt" \
    '. + [{id: $id, title: $title, source: $source, base_score: $score, novel: $novel, novel_prompt: $prompt}]')"
}

# Doc drift
DRIFT="$(bash scripts/cto-doc-drift.sh 2>&1 || true)"
WARN="$(echo "$DRIFT" | sed -n 's/DOC_DRIFT_WARNINGS=\([0-9]*\)/\1/p')"
FAIL="$(echo "$DRIFT" | sed -n 's/DOC_DRIFT_FAILURES=\([0-9]*\)/\1/p')"
if [[ "${WARN:-0}" -gt 0 || "${FAIL:-0}" -gt 0 ]]; then
  add_item "doc-drift-fix" "Fix documentation drift" "cto-doc-drift" 80 false ""
fi

# Deploy STANDBY — docs sync only, never blocks code
if [[ -f orchestrator/state.json ]]; then
  MODE="$(jq -r '.operational_mode // "UNKNOWN"' orchestrator/state.json)"
  if [[ "$MODE" == "STANDBY" ]]; then
    add_item "deploy-status-sync" "Sync AUTONOMY_STATUS deploy blockers" "deploy-gate" 55 false ""
  fi
fi

# Webhook ops-log gap (#60) — agent-executable novel work
if ! grep -q 'webhook.event_ok' src/lib/ops-log.ts 2>/dev/null; then
  add_item "webhook-ops-log" "Add webhook.event_ok structured log on LINE webhook success (#60)" "capability-gap" 72 true \
    "Add OpsLogAction webhook.event_ok to src/lib/ops-log.ts. In src/app/api/webhooks/line/route.ts log logOps(webhook, webhook.event_ok, {event_type}) after successful event handling. Add a minimal vitest for the new action string. Keep diff under 80 lines. Do not change payment logic."
fi

# Rate limit fail-open documentation in middleware
if grep -q 'fail-open\|fail open' src/middleware.ts 2>/dev/null || grep -q 'UPSTASH' src/middleware.ts 2>/dev/null; then
  if ! grep -q 'rate_limit_mode' docs/internal/governance/IMPLEMENTATION_TRUTH.md 2>/dev/null; then
    add_item "rate-limit-truth" "Document Upstash rate-limit mode in IMPLEMENTATION_TRUTH" "capability-gap CG-006" 58 true \
      "Add one row to docs/IMPLEMENTATION_TRUTH.md documenting guest rate limits: enforced when Upstash env set, fail-open otherwise. No code changes unless a single comment in middleware.ts helps."
  fi
fi

# TODO scan (bounded)
TODO_COUNT="$( (grep -rE 'TODO|FIXME' src --include='*.ts' --include='*.tsx' 2>/dev/null || true) | wc -l | tr -d ' ')"
if [[ "$TODO_COUNT" -gt 0 && "$TODO_COUNT" -le 5 ]]; then
  FIRST="$(grep -rnE 'TODO|FIXME' src --include='*.ts' 2>/dev/null | head -1 || true)"
  if [[ -n "$FIRST" ]]; then
    FILE="${FIRST%%:*}"
    add_item "todo-resolve-1" "Resolve or document TODO: ${FILE}" "grep-todo" 45 true \
      "Inspect ${FIRST}. Either fix the TODO with minimal safe change (with test) or replace with a comment explaining deferral. Max 40 lines changed."
  fi
fi

echo "$ITEMS" | jq '{generated_at: (now|strftime("%Y-%m-%dT%H:%M:%SZ")), items: .}' > "$OUT"
echo "Discovered $(jq '.items|length' "$OUT") work items → $OUT"
