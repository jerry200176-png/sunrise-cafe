#!/usr/bin/env bash
# Attempt production deploy via supported path — never blocks loop
# Usage: deploy.sh [--wait SECONDS]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"
orchestrator_root

EVIDENCE="$SCRIPT_DIR/evidence.sh"
WAIT="${2:-0}"
[[ "${1:-}" == "--wait" ]] && WAIT="${2:-300}"

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  bash "$EVIDENCE" deploy_skip '{"reason":"VERCEL_TOKEN unset — Founder: vercel deploy --prod"}'
  echo "DEPLOY: skipped (no VERCEL_TOKEN)"
  exit 2
fi

MAIN_SHA="$(git rev-parse HEAD)"
echo "Deploying main @ $MAIN_SHA to Vercel production..."

if npx vercel deploy --prod --yes --token "$VERCEL_TOKEN" 2>&1; then
  bash "$EVIDENCE" deploy_triggered "{\"sha\":\"$(git rev-parse --short HEAD)\"}"
else
  bash "$EVIDENCE" deploy_fail '{"reason":"vercel deploy command failed"}'
  exit 2
fi

# Poll for SHA match
if [[ "$WAIT" -gt 0 ]]; then
  bash "$SCRIPT_DIR/deploy-gate.sh" --wait "$WAIT" && exit 0
fi
exit 2
