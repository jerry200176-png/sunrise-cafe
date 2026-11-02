#!/usr/bin/env bash
# Only artifact metadata is accepted here; never print credentials or dump data.
set -euo pipefail
[[ "${ARTIFACT_ID:-}" =~ ^[0-9]+$ ]] || { echo '::error::backup artifact upload not confirmed: migrations will not run' >&2; exit 1; }
[[ "${ARTIFACT_DIGEST:-}" =~ ^[0-9a-fA-F]{64}$ ]] || { echo '::error::backup artifact digest missing: migrations will not run' >&2; exit 1; }
echo "backup artifact id ${ARTIFACT_ID}, archive sha256 ${ARTIFACT_DIGEST}"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s\n' "- uploaded artifact ID: ${ARTIFACT_ID}, artifact SHA-256: ${ARTIFACT_DIGEST}" >> "$GITHUB_STEP_SUMMARY"
fi
