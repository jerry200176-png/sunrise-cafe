#!/usr/bin/env bash
# Generate human + agent iteration plan from discover + priority
# Output: docs/ORCHESTRATOR_PLAN.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

DISCOVER_FILE="orchestrator/discover.env"
PRIORITY_FILE="orchestrator/priority.json"
OUT="docs/ORCHESTRATOR_PLAN.md"
STATE="orchestrator/state.json"

[[ -f "$PRIORITY_FILE" ]] || bash "$SCRIPT_DIR/prioritize.sh" >/dev/null
# shellcheck disable=SC1090
source "$DISCOVER_FILE"

DATE="$(orchestrator_now)"
SHA="$(orchestrator_short_sha)"
ITER=$((ITERATION_COUNT + 1))

NEXT="$(jq -r '.next_task // empty' "$PRIORITY_FILE")"
if [[ -z "$NEXT" || "$NEXT" == "null" ]]; then
  NEXT_ID="idle"
  NEXT_TITLE="No executable agent task — await Founder or external unblock"
  NEXT_ROLE="planner"
  NEXT_OWNER="none"
  NEXT_SCORE=0
  NEXT_EVIDENCE=""
  NEXT_VERIFY=""
else
  NEXT_ID="$(echo "$NEXT" | jq -r '.id')"
  NEXT_TITLE="$(echo "$NEXT" | jq -r '.title')"
  NEXT_ROLE="$(echo "$NEXT" | jq -r '.role')"
  NEXT_OWNER="$(echo "$NEXT" | jq -r '.owner')"
  NEXT_SCORE="$(echo "$NEXT" | jq -r '.score')"
  NEXT_EVIDENCE="$(echo "$NEXT" | jq -r '.evidence')"
  NEXT_VERIFY="$(echo "$NEXT" | jq -r '.verify')"
fi

# Update planned iteration in state.json
if [[ -f "$STATE" ]]; then
  ITER_PADDED="$(printf 'iter-%03d' "$ITER")"
  jq \
    --arg id "$ITER_PADDED" \
    --arg task "$NEXT_ID" \
    --arg title "$NEXT_TITLE" \
    --arg role "$NEXT_ROLE" \
    --arg owner "$NEXT_OWNER" \
    --argjson score "${NEXT_SCORE:-0}" \
    --arg at "$(orchestrator_now_iso)" \
    --arg gate "$GATE_STATUS" \
    --argjson health "${OVERALL_HEALTH:-0}" \
    --argjson gh "${GITHUB_SCORE:-0}" \
    '.planned_iteration = {
       id: $id,
       at: $at,
       task_id: $task,
       title: $title,
       role: $role,
       owner: $owner,
       score: $score
     }
     | .signals = {gate: $gate, overall_health: $health, github_score: $gh}' \
    "$STATE" > "${STATE}.tmp" && mv "${STATE}.tmp" "$STATE"
fi

BLOCKED_TABLE="$(jq -r '.top_blocked[]? | "| \(.id) | \(.owner) | \(.blocked_reason // "blocked") | \(.score) |"' "$PRIORITY_FILE" 2>/dev/null || true)"

cat > "$OUT" <<EOF
# Orchestrator Plan (auto-generated)

**Iteration:** iter-$(printf '%03d' "$ITER")  
**Generated:** $DATE  
**main:** \`$SHA\`  
**Policy:** [\`ORCHESTRATOR.md\`](./ORCHESTRATOR.md)

> Regenerate: \`npm run cto:orchestrator\`  
> Complete iteration: \`npm run cto:orchestrator -- complete <task_id> "<outcome>"\`

---

## Signals (discover)

| Signal | Value |
|--------|------:|
| Gate | **$GATE_STATUS** (exit $GATE_EXIT) |
| Overall health | $OVERALL_HEALTH |
| GitHub score | $GITHUB_SCORE |
| Doc drift (fail/warn) | $DOC_DRIFT_FAILURES / $DOC_DRIFT_WARNINGS |
| Production SHA match | $SHA_MATCH (\`$PROD_SHA\` vs \`$SHA\`) |
| Bot can close GitHub | $BOT_CAN_CLOSE |

---

## Selected task

| Field | Value |
|-------|-------|
| **ID** | \`$NEXT_ID\` |
| **Title** | $NEXT_TITLE |
| **Role** | [$NEXT_ROLE](../orchestrator/roles/$NEXT_ROLE.md) |
| **Owner** | $NEXT_OWNER |
| **Score** | $NEXT_SCORE |
| **Evidence** | $NEXT_EVIDENCE |

### Execution checklist

1. Read role playbook: \`orchestrator/roles/$NEXT_ROLE.md\`
2. Answer Work Gate: [\`CTO_WORK_GATE.md\`](./CTO_WORK_GATE.md)
3. Implement / execute task (1 MDU if code)
4. \`npm test\` + \`npm run cto:orchestrator -- verify\`
5. Commit, PR, merge, verify production SHA
6. \`npm run cto:orchestrator -- complete $NEXT_ID "<measurable outcome>"\`
7. Re-run \`npm run cto:orchestrator\` for next task

### Verification

$NEXT_VERIFY

---

## Blocked high-value work (Founder / gate)

| Task | Owner | Reason | Score |
|------|-------|--------|------:|
${BLOCKED_TABLE:-| — | — | none | 0 |}

See [\`FOUNDER_ACTION_LIST.md\`](./FOUNDER_ACTION_LIST.md).

---

## Stop conditions

Stop autonomous execution only when:

- Founder-only permission required (document in FOUNDER_ACTION_LIST)
- Irreversible/destructive action needs approval
- External outage blocks deploy/verify
- No executable tasks remain (\`next_task: idle\`)

Otherwise: continue to next iteration.

EOF

echo "Wrote $OUT"
echo "Plan: $NEXT_ID ($NEXT_OWNER)"
