#!/usr/bin/env bash
# Post-iteration verification
# Usage: npm run cto:orchestrator -- verify

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_root

FAIL=0
pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; FAIL=1; }
warn() { echo "⚠️  $1"; }

echo "═══════════════════════════════════════════════════════════"
echo "  Orchestrator Verify"
echo "  $(orchestrator_now)"
echo "═══════════════════════════════════════════════════════════"
echo

# Tests
if npm test >/dev/null 2>&1; then
  pass "Unit tests"
else
  fail "Unit tests"
fi

# Migrations artifact
if npm run verify:migrations >/dev/null 2>&1; then
  pass "verify:migrations"
else
  fail "verify:migrations"
fi

# Orchestrator modules
for f in discover.sh prioritize.sh plan.sh verify.sh record.sh; do
  [[ -x "scripts/orchestrator/$f" ]] && pass "orchestrator/$f executable" || fail "orchestrator/$f missing"
done

[[ -f orchestrator/task-catalog.json ]] && pass "task-catalog.json" || fail "task-catalog.json"
[[ -f orchestrator/state.json ]] && pass "state.json" || fail "state.json"
[[ -f docs/ORCHESTRATOR.md ]] && pass "ORCHESTRATOR.md" || fail "ORCHESTRATOR.md"

# Governance + plan freshness
if npm run cto:governance >/dev/null 2>&1; then
  pass "cto:governance (gate PASS)"
else
  warn "cto:governance gate BLOCK (expected until Founder/GitHub clean)"
fi

[[ -f docs/ORCHESTRATOR_PLAN.md ]] && pass "ORCHESTRATOR_PLAN.md exists" || fail "ORCHESTRATOR_PLAN.md missing"

# Production health
PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
if curl -sf --max-time 10 "${PROD_URL}/api/booking-health" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'; then
  pass "Production booking-health"
else
  fail "Production booking-health"
fi

LOCAL_SHA="$(orchestrator_short_sha)"
PROD_SHA="$(curl -sf --max-time 10 "${PROD_URL}/api/version" 2>/dev/null | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | cut -c1-7 || echo unknown)"
if [[ "$PROD_SHA" == "$LOCAL_SHA" ]]; then
  pass "Production SHA matches main ($LOCAL_SHA)"
else
  warn "Production SHA ($PROD_SHA) ≠ main ($LOCAL_SHA) — deploy may be in flight"
fi

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "Verify: PASS"
  exit 0
else
  echo "Verify: FAIL"
  exit 1
fi
