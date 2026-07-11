#!/usr/bin/env bash
# Distributed lease for autonomous loop (prevents duplicate runs)
# Usage: lease.sh acquire|release|status [RUN_ID]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

LEASE_FILE="orchestrator/lease.json"
CMD="${1:-status}"
RUN_ID="${2:-${GITHUB_RUN_ID:-local-$(date +%s)}}"
TTL_MIN="${LEASE_TTL_MINUTES:-45}"
NOW_EPOCH="$(date +%s)"
EXPIRES_EPOCH=$((NOW_EPOCH + TTL_MIN * 60))
NOW_ISO="$(orchestrator_now_iso)"

acquire() {
  if [[ -f "$LEASE_FILE" ]]; then
    HOLDER="$(jq -r '.holder // ""' "$LEASE_FILE")"
    EXPIRES="$(jq -r '.expires_epoch // 0' "$LEASE_FILE")"
    if [[ -n "$HOLDER" && "$HOLDER" != "$RUN_ID" && "$EXPIRES" -gt "$NOW_EPOCH" ]]; then
      echo "Lease held by $HOLDER until epoch $EXPIRES"
      exit 3
    fi
  fi
  jq -n \
    --arg holder "$RUN_ID" \
    --arg acquired "$NOW_ISO" \
    --argjson expires "$EXPIRES_EPOCH" \
    --argjson ttl "$TTL_MIN" \
    '{holder: $holder, acquired_at: $acquired, expires_epoch: $expires, ttl_minutes: $ttl}' \
    > "$LEASE_FILE"
  echo "Lease acquired: $RUN_ID (TTL ${TTL_MIN}m)"
}

release() {
  if [[ -f "$LEASE_FILE" ]]; then
    HOLDER="$(jq -r '.holder // ""' "$LEASE_FILE")"
    if [[ "$HOLDER" == "$RUN_ID" || "$HOLDER" == "local-"* ]]; then
      rm -f "$LEASE_FILE"
      echo "Lease released: $RUN_ID"
      return 0
    fi
  fi
  echo "No lease to release for $RUN_ID"
}

status() {
  if [[ ! -f "$LEASE_FILE" ]]; then
    echo "No active lease"
    exit 0
  fi
  cat "$LEASE_FILE"
  EXPIRES="$(jq -r '.expires_epoch // 0' "$LEASE_FILE")"
  if [[ "$EXPIRES" -le "$NOW_EPOCH" ]]; then
    echo "Lease expired"
    exit 0
  fi
  HOLDER="$(jq -r '.holder // ""' "$LEASE_FILE")"
  echo "Active holder: $HOLDER"
}

case "$CMD" in
  acquire) acquire ;;
  release) release ;;
  status) status ;;
  *) echo "Usage: lease.sh acquire|release|status [RUN_ID]" >&2; exit 1 ;;
esac
