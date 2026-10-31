#!/usr/bin/env bash
# Inspect or set Sunrise production LINE Pay Vercel env without printing secrets.
# Allowed mutations:
# - set-sandbox-url: LINE_PAY_API_BASE_URL=https://sandbox-api-pay.line.me
# - restore-fixed-link: remove LINE_PAY_CHANNEL_ID / LINE_PAY_CHANNEL_SECRET /
#   LINE_PAY_API_BASE_URL so guests fall back to the branch's fixed LINE Pay URL
# Environment mutations do not activate production. The canonical
# migration-first production workflow must perform any resulting deployment.
set -euo pipefail

MODE="${MODE:-inspect}"
SANDBOX_URL='https://sandbox-api-pay.line.me'
PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
OUT_DIR="${OUT_DIR:-out}"
mkdir -p "$OUT_DIR"
REPORT="$OUT_DIR/linepay-vercel-env.txt"

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "VERCEL_TOKEN unset" >&2
  exit 1
fi

if [[ "$MODE" != inspect && "$MODE" != set-sandbox-url && "$MODE" != restore-fixed-link ]]; then
  echo "MODE_BLOCKED: $MODE" >&2
  exit 1
fi

umask 077
PULL="$(mktemp)"
cleanup() {
  if [[ -n "${PULL:-}" && -f "$PULL" ]]; then
    shred -u "$PULL" 2>/dev/null || rm -f "$PULL"
  fi
}
trap cleanup EXIT

if [[ ! -f .vercel/project.json ]]; then
  npx vercel link --yes --token "$VERCEL_TOKEN" >/dev/null
fi

{
  echo "=== LINE Pay Vercel env mode=$MODE generated=$(date -Iseconds) ==="
  echo "PROD_URL=$PROD_URL"
  echo "--- LINE_PAY production env names ---"
  npx vercel env ls production --token "$VERCEL_TOKEN" | awk 'NR==1 {next} $1 ~ /^LINE_PAY_/ {print $1, $4, $5}'
} | tee "$REPORT"

npx vercel env pull "$PULL" --environment=production --yes --token "$VERCEL_TOKEN" >/dev/null

python3 - "$PULL" "$REPORT" <<'PY'
import sys
from pathlib import Path
pull, report = Path(sys.argv[1]), Path(sys.argv[2])
wanted = {}
for line in pull.read_text(encoding="utf-8").splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.startswith("LINE_PAY_"):
        wanted[key] = value.strip().strip('"').strip("'")
url = wanted.get("LINE_PAY_API_BASE_URL", "")
lines = [
    "--- LINE Pay presence ---",
    f"LINE_PAY_API_BASE_URL={url or '<unset>'}",
]
for key in ("LINE_PAY_CHANNEL_ID", "LINE_PAY_CHANNEL_SECRET"):
    value = wanted.get(key, "")
    lines.append(f"{key}={'present' if value else 'absent'} len={len(value) if value else 0}")
report.write_text(report.read_text(encoding="utf-8") + "\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines))
if url and "sandbox-api-pay.line.me" not in url and url.endswith("api-pay.line.me"):
    print("LIVE_API_HOST_PRESENT")
if not wanted.get("LINE_PAY_CHANNEL_ID") or not wanted.get("LINE_PAY_CHANNEL_SECRET"):
    print("SANDBOX_KEYS_MISSING")
else:
    print("CHANNEL_KEYS_PRESENT")
PY

current_url="$(python3 - "$PULL" <<'PY'
from pathlib import Path
import sys
url = ""
for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if line.startswith("LINE_PAY_API_BASE_URL="):
        url = line.split("=", 1)[1].strip().strip('"').strip("'")
print(url)
PY
)"

echo "CURRENT_LINE_PAY_API_BASE_URL=${current_url:-<unset>}" | tee -a "$REPORT"

if [[ "$MODE" = inspect ]]; then
  echo "INSPECT_ONLY: no Vercel env changed." | tee -a "$REPORT"
  exit 0
fi

remove_line_pay_env() {
  local name="$1"
  local env_name="$2"
  local names
  if ! names="$(npx vercel env ls "$env_name" --token "$VERCEL_TOKEN" | awk 'NR>1 {print $1}')"; then
    echo "ENV_LIST_FAILED: cannot verify LINE Pay environment; stopping." >&2
    return 1
  fi
  if printf '%s\n' "$names" | grep -qx "$name"; then
    npx vercel env rm "$name" "$env_name" --yes --token "$VERCEL_TOKEN"
    echo "REMOVED_${name}_${env_name}" | tee -a "$REPORT"
  else
    echo "ABSENT_${name}_${env_name}" | tee -a "$REPORT"
  fi
}

if [[ "$MODE" = restore-fixed-link ]]; then
  for env_name in production preview; do
    remove_line_pay_env LINE_PAY_CHANNEL_ID "$env_name"
    remove_line_pay_env LINE_PAY_CHANNEL_SECRET "$env_name"
    remove_line_pay_env LINE_PAY_API_BASE_URL "$env_name"
  done
  : > "$PULL"
  npx vercel env pull "$PULL" --environment=production --yes --token "$VERCEL_TOKEN" >/dev/null
  python3 - "$PULL" "$REPORT" <<'PY'
import sys
from pathlib import Path
pull, report = Path(sys.argv[1]), Path(sys.argv[2])
wanted = {}
for line in pull.read_text(encoding="utf-8").splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.startswith("LINE_PAY_"):
        wanted[key] = value.strip().strip('"').strip("'")
lines = ["--- LINE Pay presence after restore-fixed-link ---"]
for key in ("LINE_PAY_API_BASE_URL", "LINE_PAY_CHANNEL_ID", "LINE_PAY_CHANNEL_SECRET"):
    value = wanted.get(key, "")
    lines.append(f"{key}={'present' if value else 'absent'} len={len(value) if value else 0}")
if any(wanted.get(key) for key in ("LINE_PAY_CHANNEL_ID", "LINE_PAY_CHANNEL_SECRET", "LINE_PAY_API_BASE_URL")):
    lines.append("DYNAMIC_LINEPAY_STILL_ENABLED")
else:
    lines.append("FIXED_LINK_RESTORED")
report.write_text(report.read_text(encoding="utf-8") + "\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines))
PY
  if grep -Fxq 'DYNAMIC_LINEPAY_STILL_ENABLED' "$REPORT"; then
    echo "RESTORE_NOT_VERIFIED: production LINE Pay environment remains configured." >&2
    exit 1
  fi
  for env_name in production preview; do
    if ! verified_names="$(npx vercel env ls "$env_name" --token "$VERCEL_TOKEN" | awk 'NR>1 {print $1}')"; then
      echo "ENV_LIST_FAILED: cannot verify LINE Pay environment; stopping." >&2
      exit 1
    fi
    if printf '%s\n' "$verified_names" | grep -Eq '^LINE_PAY_(CHANNEL_ID|CHANNEL_SECRET|API_BASE_URL)$'; then
      echo "RESTORE_NOT_VERIFIED: LINE Pay environment remains configured." >&2
      exit 1
    fi
  done
  echo "ENV_MUTATION_APPLIED: canonical production activation remains required." | tee -a "$REPORT"
  echo "NO_PAYMENT_TEST: do not run live LINE Pay charges." | tee -a "$REPORT"
  exit 0
fi

name_present=0
if ! production_names="$(npx vercel env ls production --token "$VERCEL_TOKEN" | awk 'NR>1 {print $1}')"; then
  echo "ENV_LIST_FAILED: cannot confirm existing LINE Pay URL; no env changed." >&2
  exit 1
fi
if printf '%s\n' "$production_names" | grep -qx LINE_PAY_API_BASE_URL; then
  name_present=1
fi
if [[ "$current_url" == "$SANDBOX_URL" ]]; then
  echo "SANDBOX_URL_ALREADY_SET" | tee -a "$REPORT"
elif [[ -n "$current_url" || "$name_present" -eq 1 ]]; then
  echo "SANDBOX_URL_MISMATCH: existing value is not the expected sandbox URL; no env changed." | tee -a "$REPORT"
  exit 1
else
  printf '%s' "$SANDBOX_URL" | npx vercel env add LINE_PAY_API_BASE_URL production --token "$VERCEL_TOKEN"
  echo "SET_LINE_PAY_API_BASE_URL=$SANDBOX_URL" | tee -a "$REPORT"
fi

echo "ENV_MUTATION_APPLIED: canonical production activation remains required." | tee -a "$REPORT"
echo "NO_PAYMENT_TEST: do not run live LINE Pay charges." | tee -a "$REPORT"
