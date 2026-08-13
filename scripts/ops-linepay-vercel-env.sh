#!/usr/bin/env bash
# Inspect or set Sunrise production LINE Pay Vercel env without printing secrets.
# Allowed mutation: LINE_PAY_API_BASE_URL=https://sandbox-api-pay.line.me
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

if [[ "$MODE" != inspect && "$MODE" != set-sandbox-url ]]; then
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

name_present=0
if npx vercel env ls production --token "$VERCEL_TOKEN" | awk 'NR>1 {print $1}' | grep -qx LINE_PAY_API_BASE_URL; then
  name_present=1
fi
if [[ "$current_url" == "$SANDBOX_URL" || "$name_present" -eq 1 ]]; then
  echo "SANDBOX_URL_ALREADY_SET" | tee -a "$REPORT"
else
  printf '%s' "$SANDBOX_URL" | npx vercel env add LINE_PAY_API_BASE_URL production --token "$VERCEL_TOKEN"
  echo "SET_LINE_PAY_API_BASE_URL=$SANDBOX_URL" | tee -a "$REPORT"
fi

before_sha="$(curl -sf "$PROD_URL/api/version" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("commit",""))' || true)"
echo "PROD_SHA_BEFORE=${before_sha:-unknown}" | tee -a "$REPORT"
redeploy_ok=0
if npx vercel redeploy "$PROD_URL" --token "$VERCEL_TOKEN"; then
  redeploy_ok=1
else
  project_id="$(python3 -c 'import json; print(json.load(open(".vercel/project.json"))["projectId"])')"
  org_id="$(python3 -c 'import json; print(json.load(open(".vercel/project.json"))["orgId"])')"
  deployment_id="$(curl -sf -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v6/deployments?projectId=${project_id}&teamId=${org_id}&target=production&limit=1" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("deployments") or [{}])[0].get("uid",""))')"
  if [[ -n "$deployment_id" ]] && curl -sf -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      "https://api.vercel.com/v13/deployments?teamId=${org_id}&forceNew=1" \
      -d "{\"name\":\"sunrise-cafe\",\"deploymentId\":\"${deployment_id}\",\"target\":\"production\"}" >/tmp/vercel-redeploy.json; then
    redeploy_ok=1
    echo "REDEPLOY_API_DEPLOYMENT=$deployment_id" | tee -a "$REPORT"
  fi
fi
if [[ "$redeploy_ok" -eq 1 ]]; then
  echo "REDEPLOY_REQUESTED" | tee -a "$REPORT"
  sleep 8
  after_sha="$(curl -sf "$PROD_URL/api/version" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("commit",""))' || true)"
  echo "PROD_SHA_AFTER=${after_sha:-unknown}" | tee -a "$REPORT"
  if [[ -n "$before_sha" && -n "$after_sha" && "$before_sha" != "$after_sha" ]]; then
    echo "REDEPLOY_SHA_CHANGED before=$before_sha after=$after_sha" | tee -a "$REPORT"
  fi
else
  echo "REDEPLOY_SKIPPED_OR_FAILED: env is set; next production deploy will pick it up." | tee -a "$REPORT"
fi
echo "NO_PAYMENT_TEST: do not run live LINE Pay charges." | tee -a "$REPORT"
