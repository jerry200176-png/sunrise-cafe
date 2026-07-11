#!/usr/bin/env bash
# Probe runtime capabilities — never assume secrets exist
# Output: orchestrator/capabilities.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_require_jq
orchestrator_root

OUT="orchestrator/capabilities.json"
NOW="$(orchestrator_now_iso)"

# Codex CLI
CODEX_CLI=0
CODEX_AUTH=0
if npx --yes @openai/codex exec --help >/dev/null 2>&1; then CODEX_CLI=1; fi
if [[ -n "${OPENAI_API_KEY:-}" ]]; then CODEX_AUTH=1; fi

# Vercel deploy
VERCEL=0
if [[ -n "${VERCEL_TOKEN:-}" ]]; then VERCEL=1; fi
if npx vercel --version >/dev/null 2>&1; then :; fi

# Cursor (expected absent)
CURSOR=0
command -v cursor >/dev/null 2>&1 && CURSOR=1

# gh probes (best-effort; cloud integration token is restricted)
GH_PR_CREATE="unknown"
GH_PR_MERGE="unknown"
GH_ISSUE_CLOSE="unknown"
GH_WF_DISPATCH="unknown"
GH_PUSH="unknown"

if command -v gh >/dev/null 2>&1; then
  if gh api repos/:owner/:repo --jq .permissions.push 2>/dev/null | grep -q true; then
    GH_PUSH="allowed"
  elif gh git push --dry-run 2>&1 | grep -q "Everything up-to-date\|up to date"; then
    GH_PUSH="allowed"
  else
    GH_PUSH="$(gh git push --dry-run 2>&1 | head -1 || echo restricted)"
  fi

  CLOSE_OUT="$(gh issue close 999999999 2>&1 || true)"
  if echo "$CLOSE_OUT" | grep -qi "not accessible by integration"; then
    GH_ISSUE_CLOSE="blocked_integration"
    GH_PR_CREATE="blocked_integration"
  elif echo "$CLOSE_OUT" | grep -qi "Could not resolve"; then
    # Fake issue — try PR create probe via API
    GH_ISSUE_CLOSE="maybe_allowed"
  fi

  WF_OUT="$(gh workflow run autonomous-loop.yml 2>&1 || true)"
  if echo "$WF_OUT" | grep -qi "not accessible"; then
    GH_WF_DISPATCH="blocked_integration"
  elif echo "$WF_OUT" | grep -qi "could not create workflow"; then
    GH_WF_DISPATCH="workflow_missing_or_blocked"
  else
    GH_WF_DISPATCH="maybe_allowed"
  fi
fi

# GITHUB_ACTIONS context
IN_GHA=0
[[ -n "${GITHUB_ACTIONS:-}" ]] && IN_GHA=1

jq -n \
  --arg ts "$NOW" \
  --argjson codex_cli "$CODEX_CLI" \
  --argjson codex_auth "$CODEX_AUTH" \
  --argjson vercel_token "$VERCEL" \
  --argjson cursor_cli "$CURSOR" \
  --argjson in_gha "$IN_GHA" \
  --arg gh_push "$GH_PUSH" \
  --arg gh_pr_create "$GH_PR_CREATE" \
  --arg gh_issue_close "$GH_ISSUE_CLOSE" \
  --arg gh_wf_dispatch "$GH_WF_DISPATCH" \
  '{
    generated_at: $ts,
    in_github_actions: ($in_gha == 1),
    codex: {
      cli: ($codex_cli == 1),
      authenticated: ($codex_auth == 1),
      mode: (if $codex_auth == 1 then "exec" else "degraded_handlers" end)
    },
    vercel: {
      token_set: ($vercel_token == 1),
      deploy: (if $vercel_token == 1 then "available" else "founder_only" end)
    },
    cursor: { cli: ($cursor_cli == 1), headless: false },
    github: {
      push: $gh_push,
      pr_create: (if $in_gha == 1 then "gha_token_expected" else $gh_pr_create end),
      pr_merge: (if $in_gha == 1 then "gha_token_expected" else "unknown" end),
      issue_close: $gh_issue_close,
      workflow_dispatch: (if $in_gha == 1 then "gha_with_actions_write" else $gh_wf_dispatch end),
      note: "Cloud Cursor integration token != GITHUB_TOKEN in Actions"
    }
  }' > "$OUT"

echo "Wrote $OUT"
jq '{codex,vercel,github,in_github_actions}' "$OUT"
