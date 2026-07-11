#!/usr/bin/env bash
# Handler: autonomy-canary — minimal verifiable change for loop proof
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_ID="${GITHUB_RUN_ID:-canary-local}"
TS="$(TZ=Asia/Taipei date '+%Y-%m-%dT%H:%M:%S%z')"

bash "$SCRIPT_DIR/evidence.sh" canary_start "{\"run\":\"$RUN_ID\"}"

mkdir -p orchestrator
echo "{\"canary\":true,\"ts\":\"$TS\",\"run\":\"$RUN_ID\",\"note\":\"autonomous loop canary marker\"}" \
  > "orchestrator/canary-marker.json"

cat > docs/AUTONOMY_STATUS.md <<EOF
# Autonomy Status

**Updated:** $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')  
**Mode:** canary iteration  
**Run:** \`${RUN_ID}\`

Autonomous loop canary executed. Evidence in \`orchestrator/autonomy-evidence.jsonl\`.

| Check | Status |
|-------|--------|
| Handler | autonomy-canary |
| Marker | \`orchestrator/canary-marker.json\` |

**Operational LIVE** requires production SHA = main (see deploy gate).
EOF

echo "autonomy-canary: wrote canary-marker.json"
