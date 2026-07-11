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
    echo "═══════════════════════════════════════════════════════════"
    echo "  Next: read docs/ORCHESTRATOR_PLAN.md and execute"
    echo "═══════════════════════════════════════════════════════════"
    ;;
  verify)
    bash "$ORCH/verify.sh"
    ;;
  complete)
    shift
    bash "$ORCH/record.sh" "$@"
    ;;
  discover)
    bash "$ORCH/discover.sh"
    ;;
  prioritize)
    bash "$ORCH/prioritize.sh"
    ;;
  *)
    echo "Unknown command: $CMD" >&2
    echo "Usage: cto-orchestrator [plan|verify|complete|discover|prioritize]" >&2
    exit 1
    ;;
esac
