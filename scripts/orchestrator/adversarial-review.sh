#!/usr/bin/env bash
# Independent adversarial review — second pass after review.sh
# Usage: adversarial-review.sh [base]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_root

BASE="${1:-origin/main}"
FAIL=0

echo "=== Adversarial Review ==="

# 1. Auth routes must not weaken
if git diff "$BASE"...HEAD -- src/middleware.ts src/app/api/admin 2>/dev/null | grep -qE '^\-.*auth|^\-.*session|^\-.*password'; then
  if ! git diff "$BASE"...HEAD -- src/middleware.ts src/app/api/admin 2>/dev/null | grep -qE '^\+.*auth|^\+.*session'; then
    echo "❌ ADV: possible auth weakening"
    FAIL=1
  fi
fi

# 2. Payment routes — no auto-approve
if git diff "$BASE"...HEAD 2>/dev/null | grep -qE 'is_deposit_paid.*true|auto.*approve'; then
  echo "❌ ADV: possible payment auto-approve"
  FAIL=1
fi

# 3. Public API must not expose secrets
if git diff "$BASE"...HEAD 2>/dev/null | grep -qE '^\+.*(SERVICE_ROLE|CHANNEL_SECRET|ADMIN_PASSWORD)'; then
  echo "❌ ADV: secret-like string added"
  FAIL=1
fi

# 4. Codex second opinion when available
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  DIFF_LINES="$(git diff "$BASE"...HEAD 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$DIFF_LINES" -lt 800 ]]; then
    PROMPT="Review this diff for security/regression risks in a booking/payment app. Answer PASS or FAIL with one line reason.
$(git diff "$BASE"...HEAD 2>/dev/null | head -200)"
    if npx --yes @openai/codex exec "$PROMPT" 2>/dev/null | grep -qi '^FAIL'; then
      echo "❌ ADV: Codex review FAIL"
      FAIL=1
    else
      echo "✅ Codex adversarial pass (or inconclusive)"
    fi
  fi
else
  echo "ℹ️  Codex adversarial skipped (no OPENAI_API_KEY)"
fi

[[ "$FAIL" -eq 0 ]] && echo "Adversarial: PASS" && exit 0
echo "Adversarial: FAIL"
exit 1
