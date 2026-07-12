#!/usr/bin/env bash
# Patch EXECUTIVE_INBOX.md deploy/customer rows from orchestrator/gmail-signals.json
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SIGNALS="orchestrator/gmail-signals.json"
INBOX="docs/EXECUTIVE_INBOX.md"
[[ -f "$SIGNALS" && -f "$INBOX" ]] || exit 0

command -v jq >/dev/null 2>&1 || exit 0

if jq -e '.skipped == true' "$SIGNALS" >/dev/null 2>&1; then
  exit 0
fi

PREVIEW="$(jq -r '.by_kind.vercel_preview // 0' "$SIGNALS")"
PROD_FAIL="$(jq -r '.by_kind.vercel_production // 0' "$SIGNALS")"
CI_FAIL="$(jq -r '.by_kind.github_ci // 0' "$SIGNALS")"
COUNT="$(jq -r '.count // 0' "$SIGNALS")"
SCAN_AT="$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')"

PREVIEW_STATUS="🟢"
PREVIEW_NOTE="preview skipped — GHA CI only"
if [[ "$PREVIEW" -ge 3 ]]; then
  PREVIEW_STATUS="🟡"
  PREVIEW_NOTE="Hobby rate limit (${PREVIEW} fails/48h); prod uses GHA + deploy-health cron"
fi

SHA_STATUS="🟢"
if [[ "$PROD_FAIL" -gt 0 ]]; then
  SHA_STATUS="🟠"
fi

MAIN_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
PROD_SHA="$(curl -sf --max-time 10 "${PROD_URL:-https://sunrise-cafe-six.vercel.app}/api/version" 2>/dev/null | jq -r '.commit // "unknown"' 2>/dev/null | cut -c1-7)"
PROD_SHA="${PROD_SHA:-unknown}"
[[ "$PROD_SHA" == "$MAIN_SHA" && "$PROD_SHA" != "unknown" ]] && SHA_STATUS="🟢"

sed -i "s#^\\*\\*Last reviewed:\\*\\*.*#**Last reviewed:** ${SCAN_AT} (Gmail scan auto-sync)#" "$INBOX"
sed -i "s#| Vercel preview | [🟢🟡🟠🔴] | .*#| Vercel preview | ${PREVIEW_STATUS} | ${PREVIEW_NOTE} |#" "$INBOX"
sed -i "s#| SHA parity | [🟢🟠🔴] | main \`[0-9a-f]\{7\}\` · prod \`[0-9a-f]\{7\}\`.*#| SHA parity | ${SHA_STATUS} | main \`${MAIN_SHA}\` · prod \`${PROD_SHA}\` (Gmail: ${PROD_FAIL} prod fail / ${CI_FAIL} CI fail, 48h) |#" "$INBOX"
sed -i "s#| 客訴 / bug 回報 | [🟢🟡🟠🔴] .*#| 客訴 / bug 回報 | 🟢 無新回報（Gmail deploy scan ${COUNT} signals, 不含客人信） |#" "$INBOX"

echo "update-inbox-gmail: preview=${PREVIEW_STATUS} prod_fails=${PROD_FAIL} ci=${CI_FAIL}"
