#!/usr/bin/env bash
# Business Intelligence Snapshot — evidence for CEO-level decisions
# Works without secrets (deploy drift); full metrics when CTO_OUTCOME_SECRET set
# Output: orchestrator/business-snapshot.json

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://sunrise-cafe-six.vercel.app}"
OUT="orchestrator/business-snapshot.json"
NOW="$(TZ=Asia/Taipei date '+%Y-%m-%dT%H:%M:%S%z')"
REPO_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
REPO_SHORT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

PROD_JSON="$(curl -sf --max-time 15 "${PROD_URL}/api/version" 2>/dev/null || echo '{}')"
PROD_SHA="$(echo "$PROD_JSON" | jq -r '.commit // empty' 2>/dev/null | cut -c1-7)"
HEALTH_OK="$(curl -sf --max-time 10 "${PROD_URL}/api/booking-health" 2>/dev/null | jq -r '.ok // false' 2>/dev/null || echo false)"

SHA_PARITY="unknown"
[[ -n "$PROD_SHA" && "$REPO_SHORT" != "unknown" ]] && {
  [[ "$PROD_SHA" == "$REPO_SHORT" ]] && SHA_PARITY="true" || SHA_PARITY="false"
}

OUTCOMES_STATUS="skipped"
# Never leave outcomes as bare {} — always emit denominators (Phase 1)
OUTCOMES_JSON="$(jq -n '{
  booking_started: null,
  booking_completed: null,
  booking_completion_rate: null,
  booking_completion_numerator: null,
  booking_completion_denominator: null,
  deposit_required: null,
  deposit_completed: null,
  deposit_completion_rate: null,
  deposit_completion_numerator: null,
  deposit_completion_denominator: null,
  reminder_runs_expected: 1,
  reminder_runs_executed: null,
  reminder_runs_accepted: null,
  reminder_failure_count: null,
  zero_booking_days: null,
  outcome_data_freshness: null,
  evidence_based_decisions: 0,
  note: "denominators_present_metrics_pending_secret"
}')"
SECRET="${CTO_OUTCOME_SECRET:-${CRON_SECRET:-}}"
if [[ -n "$SECRET" ]]; then
  FETCHED="$(curl -sf --max-time 30 -H "Authorization: Bearer ${SECRET}" \
    "${PROD_URL}/api/ops/ceo-evidence" 2>/dev/null || echo '')"
  if [[ -n "$FETCHED" ]]; then
    OUTCOMES_JSON="$(echo "$FETCHED" | jq '.outcomes // {}')"
    OUTCOMES_STATUS="$(echo "$FETCHED" | jq -r '.evidence_confidence // "ok"')"
  else
    OUTCOMES_JSON="$(curl -sf --max-time 30 -H "Authorization: Bearer ${SECRET}" \
      "${PROD_URL}/api/cto/outcomes" 2>/dev/null || echo "$OUTCOMES_JSON")"
    OUTCOMES_STATUS="$(echo "$OUTCOMES_JSON" | jq -r '.status // "error"' 2>/dev/null || echo error)"
  fi
  if [[ "$OUTCOMES_STATUS" == "ok" || "$OUTCOMES_STATUS" == "high" || "$OUTCOMES_STATUS" == "medium" ]]; then
    bash "$ROOT/scripts/cto-outcome-pipeline.sh" 2>/dev/null || true
  fi
else
  OUTCOMES_STATUS="skipped_with_empty_denominators"
fi

# Business risk flags (no Supabase required)
RISKS=()
[[ "$SHA_PARITY" == "false" ]] && RISKS+=("production_sha_drift")
[[ "$HEALTH_OK" != "true" ]] && RISKS+=("booking_health_degraded")
[[ "$OUTCOMES_STATUS" != "ok" && "$OUTCOMES_STATUS" != "high" && "$OUTCOMES_STATUS" != "medium" && "$OUTCOMES_STATUS" != "skipped_with_empty_denominators" ]] && RISKS+=("outcome_metrics_unavailable")

DEPOSIT="$(echo "$OUTCOMES_JSON" | jq -r '.payment.deposit_rate_pct // empty' 2>/dev/null)"
[[ -n "$DEPOSIT" && "$DEPOSIT" != "null" ]] && {
  DEP_INT="${DEPOSIT%.*}"
  [[ "${DEP_INT:-100}" -lt 75 ]] 2>/dev/null && RISKS+=("deposit_rate_below_target") || true
}

REVIEW_H="$(echo "$OUTCOMES_JSON" | jq -r '.payment.payment_review_oldest_hours // empty' 2>/dev/null)"
[[ -n "$REVIEW_H" && "$REVIEW_H" != "null" ]] && {
  awk -v h="$REVIEW_H" 'BEGIN { exit (h > 4) ? 0 : 1 }' && RISKS+=("payment_review_sla_breach") || true
}

MIG="$(echo "$OUTCOMES_JSON" | jq -r '.migrations.all_required_applied // empty' 2>/dev/null)"
[[ "$MIG" == "false" ]] && RISKS+=("migrations_pending")

RISKS_JSON='[]'
if [[ ${#RISKS[@]} -gt 0 ]]; then
  RISKS_JSON="$(printf '%s\n' "${RISKS[@]}" | jq -R . | jq -s '.')"
fi

jq -n \
  --arg ts "$NOW" \
  --arg repo "$REPO_SHORT" \
  --arg repo_full "$REPO_SHA" \
  --arg prod "$PROD_SHA" \
  --arg parity "$SHA_PARITY" \
  --argjson health "$([[ "$HEALTH_OK" == "true" ]] && echo true || echo false)" \
  --arg outcomes "$OUTCOMES_STATUS" \
  --argjson risks "$RISKS_JSON" \
  --argjson outcomes_data "$OUTCOMES_JSON" \
  '{
    generated_at: $ts,
    horizons: {
      short_term: {
        production_reachable: ($prod != ""),
        sha_parity: $parity,
        booking_health: $health,
        risks: $risks
      },
      medium_term: {
        outcome_pipeline: $outcomes,
        ci_automation: "github_actions"
      },
      long_term: {
        evidence_based_decisions: ($outcomes == "ok")
      }
    },
    deployment: {
      repository_commit: $repo,
      repository_full: $repo_full,
      production_commit: $prod,
      sha_parity: $parity
    },
    outcomes: $outcomes_data,
    top_risks: $risks
  }' > "$OUT"

echo "Business snapshot → $OUT"
echo "  repo=$REPO_SHORT prod=$PROD_SHA parity=$SHA_PARITY outcomes=$OUTCOMES_STATUS"
echo "  risks: $(jq -r '.top_risks | join(", ")' "$OUT")"
