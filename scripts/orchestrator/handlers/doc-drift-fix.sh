#!/usr/bin/env bash
# Handler: doc-drift-fix — sync docs with repo reality (scripted, no LLM)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

TEST_COUNT="$(npm test 2>&1 | sed -n 's/.*Tests[[:space:]]*\([0-9]*\) passed.*/\1/p' | tail -1)"
TEST_COUNT="${TEST_COUNT:-0}"
MAIN_SHA="$(git rev-parse --short HEAD)"
PROD_SHA="$(curl -sf --max-time 10 "${PROD_URL:-https://sunrise-cafe-six.vercel.app}/api/version" | jq -r '.commit // "unknown"' | cut -c1-7)"

# IMPLEMENTATION_TRUTH test count
if [[ -f docs/IMPLEMENTATION_TRUTH.md ]]; then
  sed -i "s/| Tests on main | [0-9]* unit/| Tests on main | ${TEST_COUNT} unit/" docs/IMPLEMENTATION_TRUTH.md
  sed -i "s/\`[0-9a-f]\{7\}\` = production/\\\`${MAIN_SHA}\\\` = main (prod: \\\`${PROD_SHA}\\\`)/" docs/IMPLEMENTATION_TRUTH.md 2>/dev/null || true
fi

# EXECUTIVE_INBOX
if [[ -f docs/EXECUTIVE_INBOX.md ]]; then
  sed -i "s/| Tests | 🟢 | [0-9]* unit/| Tests | 🟢 | ${TEST_COUNT} unit/" docs/EXECUTIVE_INBOX.md
  sed -i "s/main \`[0-9a-f]\{7\}\`/main \`${MAIN_SHA}\`/" docs/EXECUTIVE_INBOX.md
fi

# AUTONOMY_STATUS touch
cat > docs/AUTONOMY_STATUS.md <<EOF
# Autonomy Status

**Updated:** $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')  
**Handler:** doc-drift-fix  
**main:** \`${MAIN_SHA}\` · **production:** \`${PROD_SHA}\`

Doc drift sync completed by autonomous handler. If prod SHA differs, deploy gate remains STANDBY until Vercel deploys main.

See [\`AUTONOMY_AUDIT.md\`](./AUTONOMY_AUDIT.md) and \`orchestrator/autonomy-evidence.jsonl\`.
EOF

echo "doc-drift-fix: tests=${TEST_COUNT} main=${MAIN_SHA} prod=${PROD_SHA}"
