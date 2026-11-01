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

python3 "$(dirname "$0")/production-identity-evaluate.py" \
  "$REMOTE_MAIN" "$VERSION_RAW" "$HEALTH_RAW" "$HEALTH_CODE" "$DEPLOY_JSON" \
  "$VERIFY_JSON" "$BI_JSON" "$LINE_BACKUP_JSON" "$PROD_URL" "$REPO"
