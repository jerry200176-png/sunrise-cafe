#!/usr/bin/env bash
# Handler: doc-drift-fix — sync docs with repo reality (scripted, no LLM)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# Vitest: "Tests  151 passed" or "Tests 151 passed"
TEST_COUNT="$(npm test 2>&1 | grep -oE 'Tests[[:space:]]+[0-9]+ passed' | grep -oE '[0-9]+' | tail -1)"
TEST_COUNT="${TEST_COUNT:-0}"
MAIN_SHA="$(git rev-parse --short HEAD)"
PROD_SHA="$(curl -sf --max-time 10 "${PROD_URL:-https://sunrise-cafe-six.vercel.app}/api/version" | jq -r '.commit // "unknown"' | cut -c1-7)"
SHA_STATUS="🟢"
[[ "$PROD_SHA" != "$MAIN_SHA" && "$PROD_SHA" != "unknown" ]] && SHA_STATUS="🟠"

# IMPLEMENTATION_TRUTH test count + open PR/issue counts
if [[ -f docs/IMPLEMENTATION_TRUTH.md ]]; then
  sed -i "s/| Tests on main | [0-9]* unit/| Tests on main | ${TEST_COUNT} unit/" docs/IMPLEMENTATION_TRUTH.md
  OPEN_PRS="$(gh pr list --state open --limit 100 2>/dev/null | wc -l | tr -d ' ')"
  OPEN_ISSUES="$(gh issue list --state open --limit 100 2>/dev/null | wc -l | tr -d ' ')"
  sed -i "s/| Open PRs | [0-9]* (.*)|/| Open PRs | ${OPEN_PRS} (draft ghosts + dependabot) |/" docs/IMPLEMENTATION_TRUTH.md
  sed -i "s/| Open Issues | [0-9]* |/| Open Issues | ${OPEN_ISSUES} |/" docs/IMPLEMENTATION_TRUTH.md
fi

# EXECUTIVE_INBOX
if [[ -f docs/EXECUTIVE_INBOX.md ]]; then
  sed -i "s/| Tests | 🟢 | [0-9]* unit/| Tests | 🟢 | ${TEST_COUNT} unit/" docs/EXECUTIVE_INBOX.md
  sed -i "s/| SHA parity | [🟢🟠🔴] | main \`[0-9a-f]\{7\}\` = production/| SHA parity | ${SHA_STATUS} | main \`${MAIN_SHA}\` · prod \`${PROD_SHA}\`/" docs/EXECUTIVE_INBOX.md
  sed -i "s/| SHA parity | [🟢🟠🔴] | main \`[0-9a-f]\{7\}\` · prod/| SHA parity | ${SHA_STATUS} | main \`${MAIN_SHA}\` · prod \`${PROD_SHA}\`/" docs/EXECUTIVE_INBOX.md
fi

# AUTONOMY_STATUS touch
cat > docs/AUTONOMY_STATUS.md <<EOF
# Autonomy Status

**Updated:** $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M %Z')  
**Handler:** doc-drift-fix  
**main:** \`${MAIN_SHA}\` · **production:** \`${PROD_SHA}\`  
**Mode:** $([[ "$SHA_STATUS" == "🟢" ]] && echo LIVE || echo STANDBY)

Doc drift sync completed. Production deploy remains Founder-only until SHA matches (see \`FOUNDER_ACTION_LIST.md\`).

Evidence: \`orchestrator/autonomy-evidence.jsonl\` · Audit: [\`AUTONOMY_AUDIT.md\`](./AUTONOMY_AUDIT.md)
EOF

echo "doc-drift-fix: tests=${TEST_COUNT} main=${MAIN_SHA} prod=${PROD_SHA} sha=${SHA_STATUS}"
