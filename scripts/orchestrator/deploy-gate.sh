#!/usr/bin/env bash
# Production deploy gate — LIVE vs STANDBY
# Usage: bash scripts/orchestrator/deploy-gate.sh [--wait SECONDS]
# Exit 0 = LIVE | Exit 2 = STANDBY (external deploy block)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

WAIT="${1:-0}"
if [[ "${1:-}" == "--wait" ]]; then
  WAIT="${2:-900}"
fi

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
STATE="orchestrator/state.json"
LOCAL_SHA="$(git rev-parse HEAD)"
LOCAL_SHORT="$(git rev-parse --short HEAD)"
NOW="$(orchestrator_now_iso)"

poll_prod() {
  curl -sf --max-time 15 "${PROD_URL}/api/version" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null || echo ""
}

PROD_FULL="$(poll_prod)"
elapsed=0
while [[ -n "$WAIT" && "$WAIT" -gt 0 && -n "$PROD_FULL" && "$PROD_FULL" != "$LOCAL_SHA" ]]; do
  sleep 30
  elapsed=$((elapsed + 30))
  [[ "$elapsed" -ge "$WAIT" ]] && break
  PROD_FULL="$(poll_prod)"
done

PROD_FULL="${PROD_FULL:-unknown}"
PROD_SHORT="$(echo "$PROD_FULL" | cut -c1-7)"

MODE="STANDBY"
REASON=""
if [[ "$PROD_FULL" == "$LOCAL_SHA" ]]; then
  MODE="LIVE"
elif [[ "$PROD_FULL" == "unknown" || -z "$PROD_FULL" ]]; then
  REASON="production_unreachable"
else
  REASON="sha_mismatch"
fi

# Persist into state.json
if [[ -f "$STATE" ]]; then
  jq \
    --arg mode "$MODE" \
    --arg reason "$REASON" \
    --arg main "$LOCAL_SHORT" \
    --arg prod "$PROD_SHORT" \
    --arg main_full "$LOCAL_SHA" \
    --arg prod_full "$PROD_FULL" \
    --arg at "$NOW" \
    '.operational_mode = $mode
     | .deploy = {
         status: (if $mode == "LIVE" then "synced" else "blocked" end),
         reason: (if $mode == "LIVE" then null else $reason end),
         main_sha: $main,
         prod_sha: $prod,
         main_full: $main_full,
         prod_full: $prod_full,
         checked_at: $at
       }' "$STATE" > "${STATE}.tmp" && mv "${STATE}.tmp" "$STATE"
fi

echo "## Deploy Gate"
echo "| Field | Value |"
echo "|-------|-------|"
echo "| Mode | **$MODE** |"
echo "| main | \`$LOCAL_SHORT\` |"
echo "| production | \`$PROD_SHORT\` |"
echo "| reason | ${REASON:-none} |"

if [[ "$MODE" == "LIVE" ]]; then
  exit 0
fi
exit 2
