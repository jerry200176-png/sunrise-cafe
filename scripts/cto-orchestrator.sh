#!/usr/bin/env bash
# AI Engineering Orchestrator — main entry
# Usage:
#   npm run cto:orchestrator              # discover → prioritize → plan
#   npm run cto:orchestrator -- verify
#   npm run cto:orchestrator -- complete <task_id> "<outcome>" [pr]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ORCH="$ROOT/scripts/orchestrator"

CMD="${1:-plan}"

case "$CMD" in
  plan|"")
    echo "═══════════════════════════════════════════════════════════"
    echo "  AI Engineering Orchestrator"
    echo "  $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')"
    echo "═══════════════════════════════════════════════════════════"
    echo
    bash "$ORCH/discover.sh"
    echo
    bash "$ORCH/prioritize.sh"
    echo
    bash "$ORCH/plan.sh"
    echo
    bash "$ORCH/stall-check.sh" >/dev/null 2>&1 || true
    bash "$ORCH/task-wall.sh" >/dev/null 2>&1 || true
    echo
    echo "═══════════════════════════════════════════════════════════"
    echo "  Next: read docs/internal/automation/ORCHESTRATOR_PLAN.md and execute"
    echo "═══════════════════════════════════════════════════════════"
    ;;
  verify)
    bash "$ORCH/verify.sh"
    ;;
  complete)
    shift
    bash "$ORCH/record.sh" "$@"
    ;;
  task-wall)
    bash "$ORCH/task-wall.sh"
    ;;
  stall-check)
    bash "$ORCH/stall-check.sh" || true
    ;;
  discover)
    bash "$ORCH/discover.sh"
    ;;
  prioritize)
    bash "$ORCH/prioritize.sh"
    ;;
  *)
    echo "Unknown command: $CMD" >&2
    echo "Usage: cto-orchestrator [plan|verify|complete|discover|prioritize|task-wall|stall-check]" >&2
    exit 1
    ;;
esac
