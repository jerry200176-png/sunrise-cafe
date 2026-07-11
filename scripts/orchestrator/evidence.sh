#!/usr/bin/env bash
# Append structured evidence line for autonomous iterations
# Usage: evidence.sh <phase> <json_object>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

PHASE="${1:-event}"
PAYLOAD="${2:-\{\}}"
FILE="orchestrator/autonomy-evidence.jsonl"
RUN_ID="${GITHUB_RUN_ID:-local}"

mkdir -p orchestrator
# shellcheck disable=SC2016
jq -c -n \
  --arg ts "$(orchestrator_now_iso)" \
  --arg phase "$PHASE" \
  --arg run "$RUN_ID" \
  --arg sha "$(orchestrator_short_sha)" \
  --argjson data "$PAYLOAD" \
  '{ts: $ts, phase: $phase, run_id: $run, sha: $sha, data: $data}' >> "$FILE" 2>/dev/null || \
jq -c -n \
  --arg ts "$(orchestrator_now_iso)" \
  --arg phase "$PHASE" \
  --arg run "$RUN_ID" \
  --arg sha "$(orchestrator_short_sha)" \
  '{ts: $ts, phase: $phase, run_id: $run, sha: $sha, data: {}}' >> "$FILE"

echo "evidence: $PHASE"
