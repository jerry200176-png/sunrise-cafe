#!/usr/bin/env bash
# Sunrise Cafe agent preflight — fail-closed before writes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODE="${AGENT_PREFLIGHT_MODE:-agent}"

fail() {
  echo "sunrise-preflight: FAIL: $*" >&2
  echo "sunrise-preflight: recovery: cd /home/jerry/workspace/sunrise-cafe && git fetch origin main && git checkout -b <type>/<slug> origin/main (clean tree)" >&2
  exit 1
}
ok() { echo "sunrise-preflight: OK: $*"; }

resolve() {
  local p="$1"
  realpath -m "$p" 2>/dev/null || readlink -f "$p" 2>/dev/null || echo "$p"
}

if [[ "$MODE" == "ci" ]]; then
  [[ -f "$ROOT/scripts/agent-preflight.sh" ]] || fail "script missing"
  [[ -f "$ROOT/scripts/production-identity.sh" ]] || fail "production-identity missing"
  ok "ci mode"
  exit 0
fi

TARGET="$(resolve "$(git -C "$ROOT" rev-parse --show-toplevel)")"
PWD_R="$(resolve "${PWD:-.}")"
# Must be sunrise-cafe workspace clone (or its worktree under wt/sunrise-*)
case "$TARGET" in
  /home/jerry/workspace/sunrise-cafe|/home/jerry/wt/sunrise-*) ;;
  *) fail "path not allowlisted for Sunrise writes: $TARGET" ;;
esac
case "$TARGET" in
  */workspace-backups/*|*/actions-runner*|*/mnt/c/*) fail "forbidden path class: $TARGET" ;;
esac

cd "$TARGET"
REMOTE="$(git remote get-url origin)"
case "$REMOTE" in
  *github.com/jerry200176-png/sunrise-cafe*) ;;
  *) fail "unexpected origin: $REMOTE" ;;
esac

[[ "${AGENT_PREFLIGHT_SKIP_FETCH:-0}" == "1" ]] || git fetch origin main --quiet || fail "fetch origin main failed"
ORIGIN_MAIN="$(git rev-parse origin/main)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" != "main" && "$BRANCH" != "master" ]] || fail "do not write on $BRANCH — use task branch"
echo "$BRANCH" | grep -qE '^(feat|fix|hotfix|chore|exp|perf|test|refactor|docs|build|ci)/.+' || fail "branch needs type/slug: $BRANCH"
MB="$(git merge-base HEAD origin/main)"
[[ "$MB" == "$ORIGIN_MAIN" ]] || fail "stale base merge-base=$MB origin/main=$ORIGIN_MAIN"
[[ -z "$(git status --porcelain)" ]] || fail "dirty worktree"
GIT_DIR="$(git rev-parse --git-dir)"
[[ ! -d "$GIT_DIR/rebase-merge" && ! -d "$GIT_DIR/rebase-apply" && ! -f "$GIT_DIR/MERGE_HEAD" ]] || fail "merge/rebase in progress"
[[ "${SUNRISE_PRODUCTION_MUTATION:-0}" == "0" ]] || fail "SUNRISE_PRODUCTION_MUTATION must be 0"
command -v gh >/dev/null || fail "gh missing"
gh auth status >/dev/null 2>&1 || fail "gh not authenticated"
ok "path=$TARGET branch=$BRANCH origin/main=${ORIGIN_MAIN:0:12}"
ok "preflight passed"
