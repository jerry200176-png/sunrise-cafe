#!/usr/bin/env bash
# Offline legacy pre-migration artifact drill. No database URL or production network is accepted.
# The operator supplies a local ZIP, independent GitHub ZIP digest, and local identity *path* via prompts.
set -euo pipefail
set +x
umask 077
command -v python3 >/dev/null
command -v docker >/dev/null
command -v age >/dev/null
command -v sha256sum >/dev/null
read -r -s -p 'Local encrypted artifact ZIP path: ' zip_path
printf '\n'
read -r -p 'Independent GitHub artifact digest (sha256:...): ' expected_digest
read -r -s -p 'Local age identity FILE path (not the key): ' identity_path
printf '\n'
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Open paths component by component with O_NOFOLLOW; only descriptors reach the worker.
BACKUP_DRILL_EXPECTED_DIGEST="$expected_digest" \
  printf '%s\0%s' "$zip_path" "$identity_path" | \
  BACKUP_DRILL_EXPECTED_DIGEST="$expected_digest" python3 "$script_dir/secure-open-inputs.py" "$script_dir/restore-legacy-worker.sh"
