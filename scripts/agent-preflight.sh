#!/usr/bin/env bash
# Sunrise Cafe agent preflight — fail-closed before writes.
# Official path: /home/jerry/workspace/tasks/sunrise/<task-id> via agent-start.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${AGENT_PREFLIGHT_MODE:-agent}"
TASK_PREFIX="/home/jerry/workspace/tasks/sunrise/"

fail() {
  echo "sunrise-preflight: FAIL: $*" >&2
  echo "sunrise-preflight: recovery: resolve the named blocker without bypassing the check or removing ownership metadata" >&2
  exit 1
}
ok() { echo "sunrise-preflight: OK: $*"; }

resolve() {
  local p="$1"
  realpath -m "$p" 2>/dev/null || readlink -f "$p" 2>/dev/null || echo "$p"
}

# Prefer caller's git toplevel (worktree cwd); fall back to repo containing this script.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  ROOT="$(resolve "$(git rev-parse --show-toplevel)")"
else
  ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi

if [[ "$MODE" == "ci" ]]; then
  [[ -f "$ROOT/scripts/agent-preflight.sh" ]] || fail "script missing"
  [[ -f "$ROOT/scripts/production-identity.sh" ]] || fail "production-identity missing"
  [[ -f "$ROOT/scripts/check-agent-provenance.sh" ]] || fail "provenance checker missing"
  ok "ci mode"
  exit 0
fi

TARGET="$ROOT"
PWD_R="$(resolve "${PWD:-.}")"
case "$TARGET" in
  "$TASK_PREFIX"*) ;;
  *) fail "path not allowlisted (use agent-start): $TARGET" ;;
esac
case "$TARGET" in
  */workspace-backups/*|*/actions-runner*|*/mnt/c/*|*/workspace/repos/*|*/workspace/sunrise-cafe) fail "forbidden path class: $TARGET" ;;
esac
case "$PWD_R" in
  */mnt/c/*|*/workspace-backups/*|*/actions-runner*) fail "forbidden cwd class: $PWD_R" ;;
esac
if [[ "$TARGET" == "/home/jerry/workspace/sunrise-cafe" ]]; then
  fail "legacy clone is not an official write path"
fi

cd "$TARGET"
REMOTE="$(git remote get-url origin)"
case "$REMOTE" in
  *github.com/jerry200176-png/sunrise-cafe*) ;;
  *) fail "unexpected origin: $REMOTE" ;;
esac

[[ "${AGENT_PREFLIGHT_SKIP_FETCH:-0}" == "1" ]] || git fetch origin main --quiet || fail "fetch origin main failed"
ORIGIN_MAIN="$(git rev-parse origin/main)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" != "main" && "$BRANCH" != "master" ]] || fail "do not write on $BRANCH — use agent-start"
echo "$BRANCH" | grep -qE '^(feat|fix|hotfix|chore|exp|perf|test|refactor|docs|build|ci)/.+' || fail "branch needs type/slug: $BRANCH"
MB="$(git merge-base HEAD origin/main)"
[[ "$MB" == "$ORIGIN_MAIN" ]] || fail "stale base — recreate via agent-start"
node "$SCRIPT_DIR/agent-preflight-worktree.mjs" --root "$TARGET" --branch "$BRANCH" || exit 1
GIT_DIR="$(git rev-parse --git-dir)"
[[ ! -d "$GIT_DIR/rebase-merge" && ! -d "$GIT_DIR/rebase-apply" && ! -f "$GIT_DIR/MERGE_HEAD" ]] || fail "merge/rebase in progress"
[[ "${SUNRISE_PRODUCTION_MUTATION:-0}" == "0" ]] || fail "SUNRISE_PRODUCTION_MUTATION must be 0"
command -v gh >/dev/null || fail "gh missing"
gh auth status >/dev/null 2>&1 || fail "gh not authenticated"
ok "path=$TARGET branch=$BRANCH origin/main=${ORIGIN_MAIN:0:12}"
ok "preflight passed"
