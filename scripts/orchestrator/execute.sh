#!/usr/bin/env bash
# Route task id → handler script
# Usage: execute.sh <task_id>

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

HANDLER="$(jq -r --arg id "$TASK" '.tasks[] | select(.id==$id) | .handler // ""' orchestrator/task-catalog.json)"
if [[ -z "$HANDLER" || "$HANDLER" == "null" ]]; then
  # Optional Codex path when OPENAI_API_KEY set
  if [[ -n "${OPENAI_API_KEY:-}" ]] && command -v npx >/dev/null; then
    PLAN="$(cat docs/ORCHESTRATOR_PLAN.md 2>/dev/null || echo "Execute task $TASK")"
    echo "Invoking codex exec for $TASK"
    npx --yes @openai/codex exec --full-auto "$PLAN" || {
      echo "Codex exec failed" >&2
      exit 1
    }
    exit 0
  fi
  echo "No handler for task $TASK and OPENAI_API_KEY unset" >&2
  exit 1
fi

if [[ ! -x "$HANDLER" && ! -f "$HANDLER" ]]; then
  echo "Handler missing: $HANDLER" >&2
  exit 1
fi

bash "$HANDLER"
