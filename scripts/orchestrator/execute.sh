#!/usr/bin/env bash
# Route task id → handler | codex-agent (novel) | fallback
# Usage: execute.sh <task_id>
# Exit 2 = degraded (no handler, no codex auth)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_root

TASK="${1:-}"
if [[ -z "$TASK" ]]; then
  echo "Usage: execute.sh <task_id>" >&2
  exit 1
fi

CATALOG="orchestrator/task-catalog.json"
DISCOVERED="orchestrator/discovered-work.json"

HANDLER="$(jq -r --arg id "$TASK" '.tasks[] | select(.id==$id) | .handler // ""' "$CATALOG")"
NOVEL_PROMPT="$(jq -r --arg id "$TASK" '.tasks[] | select(.id==$id) | .novel_prompt // ""' "$CATALOG")"
NOVEL_FLAG="$(jq -r --arg id "$TASK" '.tasks[] | select(.id==$id) | .novel // false' "$CATALOG")"

if [[ -f "$DISCOVERED" ]]; then
  D_PROMPT="$(jq -r --arg id "$TASK" '.items[] | select(.id==$id) | .novel_prompt // ""' "$DISCOVERED")"
  D_NOVEL="$(jq -r --arg id "$TASK" '.items[] | select(.id==$id) | .novel // false' "$DISCOVERED")"
  [[ -n "$D_PROMPT" && "$D_PROMPT" != "null" ]] && NOVEL_PROMPT="$D_PROMPT"
  [[ "$D_NOVEL" == "true" ]] && NOVEL_FLAG="true"
fi

# Handler path fallback
if [[ -z "$HANDLER" || "$HANDLER" == "null" ]]; then
  CANDIDATE="scripts/orchestrator/handlers/${TASK}.sh"
  [[ -f "$CANDIDATE" ]] && HANDLER="$CANDIDATE"
fi

export LOOP_MAIN_ROOT="$PWD"

# Novel path: Codex with bounded scope, fallback to handler
if [[ "$NOVEL_FLAG" == "true" && -n "$NOVEL_PROMPT" && "$NOVEL_PROMPT" != "null" ]]; then
  if bash "$SCRIPT_DIR/codex-agent.sh" "$TASK" "$NOVEL_PROMPT"; then
    exit 0
  fi
  CODEX_RC=$?
  if [[ "$CODEX_RC" -eq 2 ]]; then
    echo "Codex degraded — falling back to handler for $TASK"
  elif [[ "$CODEX_RC" -ne 0 ]]; then
    echo "Codex failed — trying handler fallback" >&2
  fi
fi

if [[ -n "$HANDLER" && "$HANDLER" != "null" && -f "$HANDLER" ]]; then
  bash "$HANDLER"
  exit 0
fi

# Legacy: bare codex without novel_prompt
if [[ -n "${OPENAI_API_KEY:-}" ]] && command -v npx >/dev/null; then
  PLAN="$(cat docs/ORCHESTRATOR_PLAN.md 2>/dev/null || echo "Execute task $TASK")"
  echo "Invoking codex exec for $TASK (legacy)"
  npx --yes @openai/codex exec --full-auto "$PLAN" || exit 1
  exit 0
fi

echo "No handler for $TASK and codex unavailable" >&2
exit 2
