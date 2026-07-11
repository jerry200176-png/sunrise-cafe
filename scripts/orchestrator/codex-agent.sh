#!/usr/bin/env bash
# Bounded Codex agent — novel implementation with worktree isolation
# Usage: codex-agent.sh <task_id> "<prompt>"
# Degrades: exits 2 if no API key (caller uses handler fallback)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_root

TASK="${1:-}"
PROMPT="${2:-}"
MAX_RETRIES="${CODEX_MAX_RETRIES:-2}"
RUN_ID="${GITHUB_RUN_ID:-local}"

if [[ -z "$TASK" || -z "$PROMPT" ]]; then
  echo "Usage: codex-agent.sh <task_id> \"<prompt>\"" >&2
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "CODEX_DEGRADED: OPENAI_API_KEY unset"
  exit 2
fi

WORKTREE_DIR="${LOOP_WORKTREE:-$(mktemp -d /tmp/orch-wt-XXXXXX)}"
BRANCH="cursor/auto-codex-${TASK}-$(orchestrator_short_sha)-3a90"

if [[ ! -d "$WORKTREE_DIR/.git" ]]; then
  git worktree add -B "$BRANCH" "$WORKTREE_DIR" main 2>/dev/null || \
    git worktree add "$WORKTREE_DIR" "$BRANCH" 2>/dev/null || {
      mkdir -p "$WORKTREE_DIR"
      git worktree add -f -B "$BRANCH" "$WORKTREE_DIR" HEAD
    }
fi

cd "$WORKTREE_DIR"
npm ci >/dev/null 2>&1 || npm install >/dev/null 2>&1

BOUNDED_PROMPT="$(cat <<EOF
# Autonomous engineering task (bounded)

Task ID: ${TASK}
Run: ${RUN_ID}

## Constraints (mandatory)
- Maximum 200 lines changed total
- No secrets, credentials, or .env values in code
- No database migrations or destructive SQL
- No changes to payment approval logic without tests
- Run: npm test — all tests must pass
- Taiwan SMB LINE deposit model — minimal scope

## Task
${PROMPT}

## Output
Make the changes directly in the repository. Do not explain — implement.
EOF
)"

ATTEMPT=0
while [[ "$ATTEMPT" -lt "$MAX_RETRIES" ]]; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "Codex attempt $ATTEMPT/$MAX_RETRIES"
  if npx --yes @openai/codex exec --full-auto "$BOUNDED_PROMPT"; then
    if npm test >/dev/null 2>&1; then
      echo "Codex: tests pass"
      # Copy changes back to main workspace if different worktree
      if [[ "$WORKTREE_DIR" != "$PWD" ]] && [[ -n "${LOOP_MAIN_ROOT:-}" ]]; then
        rsync -a --exclude node_modules --exclude .git "$WORKTREE_DIR/" "${LOOP_MAIN_ROOT}/" 2>/dev/null || true
      fi
      exit 0
    fi
    echo "Codex: tests failed, retry"
  fi
done

echo "Codex failed after $MAX_RETRIES attempts"
exit 1
