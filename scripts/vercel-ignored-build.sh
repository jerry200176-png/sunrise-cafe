#!/usr/bin/env bash
# Vercel Ignored Build Step — skip preview deploys; rely on GitHub Actions CI.
# Exit 0 = skip build | Exit 1 = proceed with build
# https://vercel.com/docs/project-configuration#ignored-build-step

set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  exit 1
fi

echo "Skipping Vercel preview build (PR validation via GitHub Actions CI)"
exit 0
