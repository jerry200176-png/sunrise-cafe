#!/usr/bin/env bash
# Sync deploy STANDBY status into AUTONOMY_STATUS (independent of LIVE)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

bash scripts/orchestrator/deploy-gate.sh 2>/dev/null || true
MODE="$(jq -r '.operational_mode // "STANDBY"' orchestrator/state.json)"
MAIN="$(jq -r '.deploy.main_sha // "unknown"' orchestrator/state.json)"
PROD="$(jq -r '.deploy.prod_sha // "unknown"' orchestrator/state.json)"
REASON="$(jq -r '.deploy.reason // "none"' orchestrator/state.json)"

cat >> docs/internal/automation/AUTONOMY_STATUS.md <<EOF

---
**Auto-sync:** $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z') · mode=\`${MODE}\` · main=\`${MAIN}\` prod=\`${PROD}\` (${REASON})
EOF

echo "deploy-status-sync: updated AUTONOMY_STATUS"
