#!/usr/bin/env bash
# Collect Gmail deploy/CI failure signals for orchestrator (non-blocking).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

OUT="orchestrator/gmail-signals.json"
TMP="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$TMP" "$ERR"' EXIT

if ! node scripts/gmail-scan-failures.mjs >"$TMP" 2>"$ERR"; then
  if grep -q missing_credentials "$ERR" 2>/dev/null; then
    jq -n \
      --arg at "$(orchestrator_now_iso)" \
      '{ok:false,skipped:true,reason:"missing_credentials",collected_at:$at}' >"$OUT"
    echo "gmail-signals: skipped (missing credentials)"
    exit 0
  fi
  jq -n \
    --arg at "$(orchestrator_now_iso)" \
    --arg err "$(tr -d '\n' <"$ERR" | head -c 300)" \
    '{ok:false,skipped:false,error:$err,collected_at:$at}' >"$OUT"
  echo "gmail-signals: scan failed"
  exit 0
fi

jq --arg at "$(orchestrator_now_iso)" '. + {collected_at: $at}' "$TMP" >"$OUT"
echo "gmail-signals: ok count=$(jq -r '.count // 0' "$OUT")"
