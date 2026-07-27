#!/usr/bin/env bash
# Vercel Ignored Build Step — skip preview and documentation-only builds.
# Exit 0 = skip build | Exit 1 = proceed with build
# https://vercel.com/docs/project-configuration#ignored-build-step

set -euo pipefail

if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "Skipping Vercel preview build (PR validation via GitHub Actions CI)"
  exit 0
fi

# Git-integrated production builds for docs, governance, and workflow-only
# commits do not change the deployed app and needlessly consume build quota.
# If Vercel cannot provide both SHAs (for example, a manual CLI deploy),
# continue with the deploy instead of guessing.
PREVIOUS_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
CURRENT_SHA="${VERCEL_GIT_COMMIT_SHA:-}"
if [ -n "$PREVIOUS_SHA" ] && [ -n "$CURRENT_SHA" ] && [ -d .git ]; then
  CHANGED_FILES="$(git diff --name-only "$PREVIOUS_SHA" "$CURRENT_SHA" 2>/dev/null || true)"
  if [ -n "$CHANGED_FILES" ] && ! printf '%s\n' "$CHANGED_FILES" | grep -qvE '^(docs/|\.github/|\.agents/|\.cursor/|.*\.md$|CHANGELOG\.md$|LICENSE(\..*)?$|skills-lock\.json$|\.gitignore$)'; then
    echo "Skipping Vercel production build (documentation/governance-only commit)"
    exit 0
  fi
fi

echo "Production source change detected — proceed with build"
exit 1
