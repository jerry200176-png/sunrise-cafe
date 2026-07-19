#!/usr/bin/env bash
# CEO Evidence Contract — Sunrise (machine-readable).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
SECRET="${CTO_OUTCOME_SECRET:-${CRON_SECRET:-}}"
if [[ -n "$SECRET" ]]; then
  curl -sf --max-time 30 -H "Authorization: Bearer ${SECRET}" "${PROD_URL}/api/ops/ceo-evidence" | jq .
  exit $?
fi
# Offline fallback from production-identity + empty denominators
bash "$ROOT/scripts/production-identity.sh" 2>/dev/null | python3 -c '
import json,sys,datetime
try: identity=json.load(sys.stdin)
except Exception: identity={}
out={
  "project":"sunrise-cafe",
  "as_of":datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "production":{
    "status":"red" if identity.get("overall")=="RED" else ("green" if identity.get("overall")=="GREEN" else "unknown"),
    "sha":identity.get("api_version_sha"),
    "verified": (identity.get("last_verify_production_run") or {}).get("conclusion")=="success",
  },
  "critical_jobs":{"expected":1,"executed":None,"succeeded":None,"partial":None,"failed":None,"stale":None},
  "outcomes":{
    "booking_started":None,"booking_completed":None,"booking_completion_rate":None,
    "booking_completion_numerator":None,"booking_completion_denominator":None,
    "deposit_required":None,"deposit_completed":None,"deposit_completion_rate":None,
    "deposit_completion_numerator":None,"deposit_completion_denominator":None,
    "reminder_runs_expected":1,"reminder_runs_executed":None,"reminder_runs_accepted":None,
    "reminder_failure_count":None,"zero_booking_days":None,"outcome_data_freshness":None,
    "evidence_based_decisions":0,"note":"secret_required_for_live_outcomes"
  },
  "risks":identity.get("drift_red") or [],
  "founder_decisions_required":[],
  "evidence_confidence":"low",
}
print(json.dumps(out,indent=2,ensure_ascii=False))
'
