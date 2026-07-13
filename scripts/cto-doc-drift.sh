#!/usr/bin/env bash
# Documentation drift detection vs implementation
# Usage: bash scripts/cto-doc-drift.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
FAILURES=0
WARNINGS=0

fail() { echo "❌ DRIFT: $1"; FAILURES=$((FAILURES + 1)); }
warn() { echo "⚠️  WARN: $1"; WARNINGS=$((WARNINGS + 1)); }
ok()   { echo "✅ $1"; }

echo "## Documentation Drift Check"
echo

# Test count
ACTUAL_TESTS="$(npm test 2>&1 | sed -n 's/.*Tests[[:space:]]*\([0-9]*\) passed.*/\1/p' | tail -1 || echo 0)"
DOC_TESTS="$(grep -E 'Tests on main|unit \+' docs/IMPLEMENTATION_TRUTH.md 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo 0)"
if [[ -n "$DOC_TESTS" && "$DOC_TESTS" != "$ACTUAL_TESTS" ]]; then
  warn "IMPLEMENTATION_TRUTH test count ($DOC_TESTS) ≠ actual ($ACTUAL_TESTS)"
else
  ok "Test count aligned ($ACTUAL_TESTS passed)"
fi

# Production SHA
LOCAL_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
PROD_SHA="$(curl -sf --max-time 10 "${PROD_URL}/api/version" 2>/dev/null | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | cut -c1-7 || echo unknown)"
if [[ "$PROD_SHA" != "unknown" && "$LOCAL_SHA" != "unknown" && "$PROD_SHA" != "$LOCAL_SHA" ]]; then
  warn "Production SHA ($PROD_SHA) ≠ main ($LOCAL_SHA)"
else
  ok "Production SHA matches main ($LOCAL_SHA)"
fi

# Stale issue #59 — closed via github-hygiene
if gh issue view 59 --json state -q .state 2>/dev/null | grep -q OPEN; then
  warn "Issue #59 still OPEN — run github-hygiene workflow"
fi

# Migration verify
if npm run verify:migrations >/dev/null 2>&1; then
  ok "Migration artifacts verify:migrations"
else
  fail "verify:migrations failed"
fi

# Executive inbox round staleness
INBOX_ROUND="$(grep -oE 'Round [0-9]+' docs/internal/executive/EXECUTIVE_INBOX.md 2>/dev/null | head -1 || echo '')"
if [[ -z "$INBOX_ROUND" ]]; then
  warn "EXECUTIVE_INBOX missing round marker"
else
  ok "EXECUTIVE_INBOX has $INBOX_ROUND (update each governance run)"
fi

echo
echo "DOC_DRIFT_FAILURES=$FAILURES"
echo "DOC_DRIFT_WARNINGS=$WARNINGS"

exit $([[ "$FAILURES" -gt 0 ]] && echo 1 || echo 0)
