#!/usr/bin/env bash
# Machine-readable Sunrise production identity (read-only).
set -euo pipefail

REPO="${SUNRISE_REPO:-jerry200176-png/sunrise-cafe}"
PROD_URL="${SUNRISE_PROD_URL:-https://sunrise-cafe-six.vercel.app}"

need() { command -v "$1" >/dev/null || { echo "missing $1" >&2; exit 2; }; }
need curl; need python3; need gh; need git

REMOTE_MAIN="$(git ls-remote "https://github.com/${REPO}.git" refs/heads/main | awk '{print $1}')" || REMOTE_MAIN=""
VERSION_RAW="$(curl -sS --max-time 20 "${PROD_URL}/api/version" || true)"
if HEALTH_RESPONSE="$(curl -sS --max-time 20 --write-out $'\n%{http_code}' "${PROD_URL}/api/booking-health")"; then
  HEALTH_CODE="${HEALTH_RESPONSE##*$'\n'}"
  HEALTH_RAW="${HEALTH_RESPONSE%$'\n'*}"
else
  HEALTH_CODE=000
  HEALTH_RAW=""
fi

# Latest successful production deployment via GitHub environments API if present
DEPLOY_JSON="$(gh api "repos/${REPO}/deployments?environment=Production&per_page=1" 2>/dev/null || echo '[]')"
# Verification is required within the release run; inspect that parent's result.
VERIFY_JSON="$(gh run list -R "$REPO" --workflow=production-code-only.yml --limit 1 --json databaseId,conclusion,status,headSha,createdAt,url 2>/dev/null || echo '[]')"
BI_JSON="$(gh run list -R "$REPO" --workflow=business-intelligence.yml --limit 1 --json databaseId,conclusion,createdAt,url 2>/dev/null || echo '[]')"
LINE_BACKUP_JSON="$(gh run list -R "$REPO" --workflow=send-line-reminder-backup.yml --limit 1 --json databaseId,conclusion,createdAt,url,displayTitle 2>/dev/null || echo '[]')"

python3 "$(dirname "$0")/production-identity-evaluate.py" \
  "$REMOTE_MAIN" "$VERSION_RAW" "$HEALTH_RAW" "$HEALTH_CODE" "$DEPLOY_JSON" \
  "$VERIFY_JSON" "$BI_JSON" "$LINE_BACKUP_JSON" "$PROD_URL" "$REPO"
