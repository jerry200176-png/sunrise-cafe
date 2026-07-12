#!/usr/bin/env bash
# Collect Gmail signals + archive inbox noise (non-blocking).
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
ACTIONABLE="$(jq -r '.actionable_count // .count // 0' "$OUT")"
echo "gmail-signals: ok actionable=${ACTIONABLE}"

# Archive PR-thread / preview / stale CI noise (opt-out with GMAIL_TRIAGE_APPLY=0)
if [[ "${GMAIL_TRIAGE_APPLY:-1}" != "0" ]]; then
  TRIAGE_JSON="$(node scripts/gmail-triage-inbox.mjs --apply 2>/dev/null || echo '{}')"
  ARCHIVED="$(echo "$TRIAGE_JSON" | jq -r '.archived // 0' 2>/dev/null || echo 0)"
  jq --argjson archived "$ARCHIVED" '. + {inbox_archived: $archived}' "$OUT" >"${OUT}.tmp" && mv "${OUT}.tmp" "$OUT"
  echo "gmail-triage: archived=${ARCHIVED}"
fi
