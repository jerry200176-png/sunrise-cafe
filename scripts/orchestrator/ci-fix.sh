#!/usr/bin/env bash
# Safe CI failure remediation — bounded retries
# Usage: ci-fix.sh <pr_number>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_root

PR="${1:-}"
[[ -z "$PR" ]] && exit 1

BRANCH="$(gh pr view "$PR" --json headRefName -q .headRefName 2>/dev/null || echo "")"
[[ -z "$BRANCH" ]] && exit 1

git fetch origin "$BRANCH" 2>/dev/null || true
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"

FIXED=0

# Lint auto-fix
if npm run lint 2>&1 | grep -qE 'error|Error'; then
  npm run lint -- --fix 2>/dev/null || true
  if ! npm run lint 2>&1 | grep -qE 'error|Error'; then
    FIXED=1
  fi
fi

# Re-run tests
if npm test >/dev/null 2>&1; then
  if [[ "$FIXED" -eq 1 ]]; then
    git add -A
    git commit -m "auto: ci-fix lint" || true
    git push origin "$BRANCH"
    bash "$SCRIPT_DIR/evidence.sh" ci_fix "{\"pr\":$PR,\"fix\":\"lint\"}"
    exit 0
  fi
fi

exit 1
