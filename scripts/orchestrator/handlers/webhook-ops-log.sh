#!/usr/bin/env bash
# Fallback handler: webhook success ops-log (#60) — idempotent
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

if grep -q 'webhook.event_ok' src/lib/ops-log.ts && grep -q 'webhook.event_ok' src/app/api/webhooks/line/route.ts; then
  echo "webhook-ops-log: already implemented — no-op"
  exit 0
fi

echo "webhook-ops-log: TypeScript implementation required — run codex or apply manually" >&2
exit 1
