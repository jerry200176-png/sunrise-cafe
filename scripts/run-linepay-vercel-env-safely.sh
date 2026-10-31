#!/usr/bin/env bash
# Keep raw output private; publish only a validated, reduced report.
set -euo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p out
rm -f -- out/linepay-vercel-env.txt
private_dir="$(mktemp -d)"
cleanup() { rm -rf -- "$private_dir"; }
trap cleanup EXIT

if ! OUT_DIR="$private_dir/ops" bash "$script_dir/ops-linepay-vercel-env.sh" >"$private_dir/output" 2>&1; then
  if grep -Fxq 'SANDBOX_URL_MISMATCH: existing value is not the expected sandbox URL; no env changed.' "$private_dir/ops/linepay-vercel-env.txt" 2>/dev/null; then
    echo '::error::Existing LINE Pay URL is different or unreadable; no environment change was made.' >&2
  else
    echo '::error::LINE Pay environment operation failed; raw output withheld.' >&2
  fi
  exit 1
fi
if ! python3 "$script_dir/sanitize-linepay-report.py" \
  "$private_dir/ops/linepay-vercel-env.txt" "$private_dir/output" "$private_dir/safe-report" "${MODE:-inspect}"; then
  echo '::error::LINE Pay environment output failed validation; raw output withheld.' >&2
  exit 1
fi
install -m 600 "$private_dir/safe-report" out/linepay-vercel-env.txt
cat out/linepay-vercel-env.txt
