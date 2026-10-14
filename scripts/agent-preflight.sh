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
# Cloud agent sessions (Claude Code on the web/mobile) run in a fresh, isolated clone with no
# /home/jerry workspace and no gh CLI. They are identified by the runner's own environment and
# prove provenance through the agent-session-cloud manifest + Claude-Session commit trailers.
# Environment variables alone are self-assertable, so cloud mode also requires runner-provided evidence:
# the managed container's agent proxy status endpoint must answer. This is an integrity guard, not an
# authentication boundary (a determined local operator can fake anything this script checks); the
# enforced boundary is CI provenance (Claude-Session trailers on every commit) plus review.
CLOUD=0
if [[ "$MODE" == "agent" && "${CLAUDE_CODE_REMOTE:-}" == "true" && "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" =~ ^cse_[A-Za-z0-9]{8,}$ ]]; then
  if [[ -n "${HTTPS_PROXY:-}" ]] && curl -fsS --max-time 5 -o /dev/null "${HTTPS_PROXY%/}/__agentproxy/status" 2>/dev/null; then
    CLOUD=1
  else
    fail "cloud markers set but the Claude Code cloud runner could not be verified (agent proxy unreachable)"
  fi
fi
if [[ "$CLOUD" == "0" ]]; then
  case "$TARGET" in
    "$TASK_PREFIX"*) ;;
    *) fail "path not allowlisted (use agent-start): $TARGET" ;;
  esac
fi
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
CLASSIFIER_ARGS=(--root "$TARGET" --branch "$BRANCH")
if [[ "$CLOUD" == "1" ]]; then
  CLASSIFIER_ARGS+=(--cloud)
  # One-time per cloud session: preflight itself writes the manifest (cloud has no agent-start gateway).
  [[ "${AGENT_PREFLIGHT_BOOTSTRAP_MANIFEST:-0}" == "1" ]] && CLASSIFIER_ARGS+=(--bootstrap-manifest)
fi
node "$SCRIPT_DIR/agent-preflight-worktree.mjs" "${CLASSIFIER_ARGS[@]}" || exit 1
GIT_DIR="$(git rev-parse --git-dir)"
[[ ! -d "$GIT_DIR/rebase-merge" && ! -d "$GIT_DIR/rebase-apply" && ! -f "$GIT_DIR/MERGE_HEAD" ]] || fail "merge/rebase in progress"
[[ "${SUNRISE_PRODUCTION_MUTATION:-0}" == "0" ]] || fail "SUNRISE_PRODUCTION_MUTATION must be 0"
if [[ "$CLOUD" == "0" ]]; then
  command -v gh >/dev/null || fail "gh missing"
  gh auth status >/dev/null 2>&1 || fail "gh not authenticated"
else
  ok "cloud session ${CLAUDE_CODE_REMOTE_SESSION_ID} (GitHub via the session connector, not gh)"
fi
ok "path=$TARGET branch=$BRANCH origin/main=${ORIGIN_MAIN:0:12}"
ok "preflight passed"
