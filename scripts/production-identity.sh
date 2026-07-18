#!/usr/bin/env bash
# Machine-readable Sunrise production identity (read-only).
set -euo pipefail

REPO="${SUNRISE_REPO:-jerry200176-png/sunrise-cafe}"
PROD_URL="${SUNRISE_PROD_URL:-https://sunrise-cafe-six.vercel.app}"

need() { command -v "$1" >/dev/null || { echo "missing $1" >&2; exit 2; }; }
need curl; need python3; need gh; need git

REMOTE_MAIN="$(git ls-remote "https://github.com/${REPO}.git" refs/heads/main | awk '{print $1}')"
VERSION_RAW="$(curl -sS --max-time 20 "${PROD_URL}/api/version" || true)"
HEALTH_RAW="$(curl -sS --max-time 20 "${PROD_URL}/api/booking-health" || true)"
HEALTH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${PROD_URL}/api/booking-health" || echo 000)"

# Latest successful production deployment via GitHub environments API if present
DEPLOY_JSON="$(gh api "repos/${REPO}/deployments?environment=Production&per_page=1" 2>/dev/null || echo '[]')"
VERIFY_JSON="$(gh run list -R "$REPO" --workflow=verify-production.yml --limit 1 --json databaseId,conclusion,status,headSha,createdAt,url 2>/dev/null || echo '[]')"
BI_JSON="$(gh run list -R "$REPO" --workflow=business-intelligence.yml --limit 1 --json databaseId,conclusion,createdAt,url 2>/dev/null || echo '[]')"
LINE_BACKUP_JSON="$(gh run list -R "$REPO" --workflow=send-line-reminder-backup.yml --limit 1 --json databaseId,conclusion,createdAt,url,displayTitle 2>/dev/null || echo '[]')"

python3 - "$REMOTE_MAIN" "$VERSION_RAW" "$HEALTH_RAW" "$HEALTH_CODE" "$DEPLOY_JSON" "$VERIFY_JSON" "$BI_JSON" "$LINE_BACKUP_JSON" "$PROD_URL" "$REPO" <<'PY'
import json,sys,datetime
from datetime import datetime, timezone
remote_main, version_raw, health_raw, health_code, deploy_json, verify_json, bi_json, line_json, prod_url, repo = sys.argv[1:11]

def parse(raw, default=None):
    try:
        return json.loads(raw) if raw else default
    except Exception:
        return default

version = parse(version_raw, {}) or {}
health = parse(health_raw, {}) or {}
deploys = parse(deploy_json, []) or []
verify = (parse(verify_json, []) or [None])[0]
bi = (parse(bi_json, []) or [None])[0]
line = (parse(line_json, []) or [None])[0]
deploy = deploys[0] if deploys else None

prod_commit = version.get('commit')
health_ok = health_code == '200' and health.get('ok') is True
stripe = health.get('stripe_enabled')

red=[]
if not remote_main:
    red.append('remote_main_unknown')
if not prod_commit:
    red.append('api_version_sha_unknown')
if remote_main and prod_commit:
    pc=str(prod_commit)
    if not (remote_main == pc or remote_main.startswith(pc) or pc.startswith(remote_main[:12])):
        red.append('remote_main_ne_api_version_sha')
if not health_ok:
    red.append('booking_health_not_ok')
if verify and verify.get('conclusion') in ('failure','cancelled'):
    red.append('production_verification_not_success')
bi_created = (bi or {}).get('createdAt')
outcome_freshness = 'unknown'
if bi_created:
    ts=datetime.fromisoformat(bi_created.replace('Z','+00:00'))
    age_h=(datetime.now(timezone.utc)-ts).total_seconds()/3600
    outcome_freshness = 'fresh' if age_h <= 36 else 'stale'
    if outcome_freshness == 'stale':
        red.append('outcome_pipeline_stale')
line_exec = {
  'backup_workflow_conclusion': (line or {}).get('conclusion'),
  'backup_workflow_at': (line or {}).get('createdAt'),
  'execution_vs_delivery': 'unknown_without_cron_secret',
  'note': 'Execution: cron/job_runs; Delivery: LINE API success counts — must not be conflated',
}

identity={
  'project': 'sunrise-cafe',
  'generated_at': datetime.now(timezone.utc).isoformat(),
  'prod_url': prod_url,
  'repo': repo,
  'remote_main_full_sha': remote_main,
  'vercel_deployment_sha': (deploy or {}).get('sha') if deploy else None,
  'api_version_sha': prod_commit,
  'last_production_deployment': deploy,
  'last_verify_production_run': verify,
  'migration_version': None,
  'migration_version_status': 'unknown_without_service_role_probe',
  'booking_health': health,
  'booking_health_http': health_code,
  'payment_integration_status': {
    'stripe_enabled': stripe,
    'mode': 'line_deposit_screenshot' if stripe is False else 'stripe_or_mixed',
  },
  'line_reminder': line_exec,
  'outcome_pipeline': {
    'last_bi_run': bi,
    'freshness': outcome_freshness,
  },
  'drift_red': red,
  'overall': 'RED' if red else 'GREEN',
}
print(json.dumps(identity, indent=2, ensure_ascii=False))
sys.exit(1 if red else 0)
PY
