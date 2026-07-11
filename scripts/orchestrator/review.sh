#!/usr/bin/env bash
# Independent review step — policy checks on diff (no LLM required)
# Optional: codex exec review when OPENAI_API_KEY set
# Usage: review.sh [base_branch]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_root

BASE="${1:-origin/main}"
FAIL=0

echo "═══════════════════════════════════════════════════════════"
echo "  Autonomous Review"
echo "  $(orchestrator_now)"
echo "═══════════════════════════════════════════════════════════"

# Diff stats
ADDED="$(git diff --stat "$BASE"...HEAD 2>/dev/null | tail -1 || echo "")"
echo "Diff: ${ADDED:-no changes}"

LINES="$(git diff --shortstat "$BASE"...HEAD 2>/dev/null | awk '{print $4+$6}' || echo 0)"
MAX_LINES=500
[[ "${LOOP_BOOTSTRAP:-}" == "1" ]] && MAX_LINES=1200
if [[ "${LINES:-0}" -gt "$MAX_LINES" ]]; then
  echo "❌ REVIEW: diff > $MAX_LINES lines ($LINES) — split required"
  FAIL=1
else
  echo "✅ Diff size OK (${LINES:-0} lines, max $MAX_LINES)"
fi

# Forbidden patterns in diff
if git diff "$BASE"...HEAD 2>/dev/null | grep -qE '^\+.*(SUPABASE_SERVICE_ROLE|ADMIN_PASSWORD|LINE_CHANNEL_SECRET|sk-)'; then
  echo "❌ REVIEW: possible secret in diff"
  FAIL=1
else
  echo "✅ No obvious secrets in diff"
fi

# Destructive SQL / migration apply
if git diff --name-only "$BASE"...HEAD 2>/dev/null | grep -qE 'supabase/migration' && \
   git diff "$BASE"...HEAD 2>/dev/null | grep -qE '^\+.*(DROP TABLE|DELETE FROM|TRUNCATE)'; then
  echo "❌ REVIEW: destructive SQL detected — Founder required"
  FAIL=1
else
  echo "✅ No destructive SQL"
fi

# Optional Codex review
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  echo "Running codex exec review (optional)..."
  if npx --yes @openai/codex exec review --base "$BASE" 2>/dev/null; then
    echo "✅ Codex review completed"
  else
    echo "⚠️  Codex review skipped/failed — scripted checks still apply"
  fi
fi

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "Review: PASS"
  exit 0
fi
echo "Review: FAIL"
exit 1
