#!/usr/bin/env bash
# CEO Evidence — operator-only read path (Phase 2).
# Priority:
#   1) CTO_OUTCOME_SECRET / CRON_SECRET → live /api/ops/ceo-evidence
#   2) Latest successful Business Intelligence artifact (secrets stay in Actions)
# Never print secrets. Never invent zero outcomes on access failure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
REPO="${SUNRISE_REPO:-jerry200176-png/sunrise-cafe}"
OUT="${1:-/tmp/sunrise-ceo-evidence.json}"
SECRET="${CTO_OUTCOME_SECRET:-${CRON_SECRET:-}}"

write_unauthorized() {
  python3 - "$OUT" <<'PY'
import json,sys,datetime
out=sys.argv[1]
obj={
  "project":"sunrise-cafe",
  "as_of":datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "production":{"status":"unknown","sha":None,"verified":False},
  "critical_jobs":{"expected":1,"executed":None,"succeeded":None,"partial":None,"failed":None,"stale":None},
  "outcomes":{
    "booking_started":None,"booking_completed":None,"booking_completion_rate":None,
    "booking_completion_numerator":None,"booking_completion_denominator":None,
    "deposit_required":None,"deposit_completed":None,"deposit_completion_rate":None,
    "deposit_completion_numerator":None,"deposit_completion_denominator":None,
    "reminder_runs_expected":7,"reminder_runs_executed":None,"reminder_runs_accepted":None,
    "reminder_failure_count":None,"zero_booking_days":None,"outcome_data_freshness":None,
    "evidence_based_decisions":0
  },
  "outcome_access":"unauthorized",
  "outcome_freshness_hours":None,
  "risks":["outcome_access_unauthorized"],
  "founder_decisions_required":[],
  "evidence_confidence":"low",
  "operator_note":"Set CTO_OUTCOME_SECRET or download Business Intelligence artifact via gh"
}
open(out,"w").write(json.dumps(obj,indent=2,ensure_ascii=False)+"\n")
print(json.dumps(obj,indent=2,ensure_ascii=False))
PY
}

if [[ -n "$SECRET" ]]; then
  CODE=$(curl -sS -o "$OUT" -w '%{http_code}' --max-time 45 \
    -H "Authorization: Bearer ${SECRET}" \
    "${PROD_URL}/api/ops/ceo-evidence" || echo 000)
  if [[ "$CODE" == "200" ]]; then
    python3 - "$OUT" <<'PY'
import json,sys
p=sys.argv[1]
d=json.load(open(p))
access=d.get("outcome_access")
conf=d.get("evidence_confidence")
print(json.dumps(d,indent=2,ensure_ascii=False))
print(f"operator: access={access} confidence={conf}", file=sys.stderr)
if access in ("unauthorized","unavailable"):
  raise SystemExit(2)
PY
    exit 0
  fi
  if [[ "$CODE" == "401" ]]; then
    write_unauthorized
    exit 2
  fi
  echo "operator: live endpoint HTTP $CODE — trying BI artifact" >&2
fi

# Artifact path (secrets never leave Actions)
if ! command -v gh >/dev/null; then
  write_unauthorized
  exit 2
fi

RUN_ID=$(gh run list -R "$REPO" --workflow=business-intelligence.yml --limit 5 \
  --json databaseId,conclusion,status \
  --jq '[.[]|select(.conclusion=="success")][0].databaseId' 2>/dev/null || true)

if [[ -z "$RUN_ID" || "$RUN_ID" == "null" ]]; then
  echo "operator: no successful BI run — dispatching workflow_dispatch" >&2
  gh workflow run "Business Intelligence" -R "$REPO" >/dev/null
  write_unauthorized
  echo "operator: BI dispatched; re-run this script after success" >&2
  exit 3
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if ! gh run download "$RUN_ID" -R "$REPO" -n "business-snapshot-${RUN_ID}" -D "$TMP" 2>/dev/null; then
  # name may vary — download all
  gh run download "$RUN_ID" -R "$REPO" -D "$TMP" 2>/dev/null || true
fi
CEO=$(find "$TMP" -name 'ceo-evidence.json' | head -1 || true)
SNAP=$(find "$TMP" -name 'business-snapshot.json' | head -1 || true)

if [[ -n "$CEO" && -f "$CEO" ]]; then
  python3 - "$CEO" "$OUT" "$RUN_ID" <<'PY'
import json,sys
ceo=json.load(open(sys.argv[1]))
out_path, run_id = sys.argv[2], sys.argv[3]
ceo["operator_source"]=f"actions-artifact:ceo-evidence:{run_id}"
ceo.setdefault("outcomes",{})["bi_run_id"]=int(run_id)
open(out_path,"w").write(json.dumps(ceo,indent=2,ensure_ascii=False)+"\n")
print(json.dumps(ceo,indent=2,ensure_ascii=False))
access=ceo.get("outcome_access")
print(f"operator: artifact access={access} confidence={ceo.get('evidence_confidence')}", file=sys.stderr)
if access in ("unauthorized","unavailable"):
  raise SystemExit(2)
PY
  exit $?
fi

if [[ -z "$SNAP" || ! -f "$SNAP" ]]; then
  write_unauthorized
  echo "operator: BI artifact missing snapshot" >&2
  exit 2
fi

python3 - "$SNAP" "$OUT" "$RUN_ID" <<'PY'
import json,sys,datetime
snap=json.load(open(sys.argv[1]))
out_path=sys.argv[2]
run_id=sys.argv[3]
# Prefer nested full CEO contract written by newer BI
if isinstance(snap.get("ceo_evidence"), dict) and snap["ceo_evidence"].get("outcome_access"):
    obj=dict(snap["ceo_evidence"])
    obj["operator_source"]=f"actions-artifact:bi:{run_id}"
    obj.setdefault("outcomes",{})["bi_run_id"]=int(run_id)
    open(out_path,"w").write(json.dumps(obj,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps(obj,indent=2,ensure_ascii=False))
    if obj.get("outcome_access") in ("unauthorized","unavailable"):
        raise SystemExit(2)
    raise SystemExit(0)

raw=snap.get("outcomes") or {}
access=snap.get("outcome_access") or raw.get("outcome_access")
pending_notes=("denominators_present_metrics_pending_secret","metrics_pending_operator_or_service_role")
# If still empty / pending from old BI, mark unavailable — never coerce to zeros
if raw == {} or raw.get("note") in pending_notes or (access in (None,"unavailable") and raw.get("booking_started") is None):
    access="unavailable"
    outcomes={
      "booking_started":None,"booking_completed":None,"booking_completion_rate":None,
      "booking_completion_numerator":None,"booking_completion_denominator":None,
      "deposit_required":None,"deposit_completed":None,"deposit_completion_rate":None,
      "deposit_completion_numerator":None,"deposit_completion_denominator":None,
      "reminder_runs_expected":7,"reminder_runs_executed":None,"reminder_runs_accepted":None,
      "reminder_failure_count":None,"zero_booking_days":None,
      "outcome_data_freshness":snap.get("generated_at"),
      "evidence_based_decisions":0,
      "bi_run_id":int(run_id),
    }
    conf="low"
    risks=["outcome_metrics_unavailable","bi_snapshot_empty"]
else:
    started=raw.get("booking_started")
    if access in ("ok","zero_activity","stale","unauthorized","unavailable"):
        pass
    elif started == 0:
        access="zero_activity"
    elif started is None:
        access="unavailable"
    else:
        access="ok"
    conf="high" if access in ("ok","zero_activity") else ("medium" if access=="stale" else "low")
    outcomes=dict(raw)
    outcomes["bi_run_id"]=int(run_id)
    risks=[] if access in ("ok","zero_activity") else ["outcome_metrics_unavailable"]

obj={
  "project":"sunrise-cafe",
  "as_of":datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "production":{
    "status":"green" if (snap.get("deployment") or {}).get("sha_parity") in (True,"true") else "amber",
    "sha":(snap.get("deployment") or {}).get("production_commit"),
    "verified": bool((snap.get("horizons") or {}).get("short_term",{}).get("booking_health")),
  },
  "critical_jobs":{"expected":1,"executed":None,"succeeded":None,"partial":None,"failed":None,"stale":None},
  "outcomes":outcomes,
  "outcome_access":access,
  "outcome_freshness_hours":None,
  "risks":risks + list((snap.get("top_risks") or [])),
  "founder_decisions_required":[],
  "evidence_confidence":conf,
  "operator_source":f"actions-artifact:bi:{run_id}",
}
open(out_path,"w").write(json.dumps(obj,indent=2,ensure_ascii=False)+"\n")
print(json.dumps(obj,indent=2,ensure_ascii=False))
if access in ("unauthorized","unavailable"):
    raise SystemExit(2)
PY
