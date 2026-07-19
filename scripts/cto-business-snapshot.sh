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

OUTCOMES_STATUS="unavailable"
OUTCOME_ACCESS="unavailable"
# Never leave outcomes as bare {} — null denominators mean unavailable, not zero
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
  reminder_runs_expected: 7,
  reminder_runs_executed: null,
  reminder_runs_accepted: null,
  reminder_failure_count: null,
  zero_booking_days: null,
  outcome_data_freshness: null,
  evidence_based_decisions: 0,
  note: "metrics_pending_operator_or_service_role"
}')"
CEO_EVIDENCE_PATH="orchestrator/ceo-evidence.json"
SECRET="${CTO_OUTCOME_SECRET:-${CRON_SECRET:-}}"

# Path 1: authenticated production endpoint (Bearer stays in Actions / operator env)
if [[ -n "$SECRET" ]]; then
  FETCHED="$(curl -sf --max-time 30 -H "Authorization: Bearer ${SECRET}" \
    "${PROD_URL}/api/ops/ceo-evidence" 2>/dev/null || echo '')"
  if [[ -n "$FETCHED" ]]; then
    echo "$FETCHED" > "$CEO_EVIDENCE_PATH"
    OUTCOMES_JSON="$(echo "$FETCHED" | jq '.outcomes // {}')"
    OUTCOME_ACCESS="$(echo "$FETCHED" | jq -r '.outcome_access // "unavailable"')"
    OUTCOMES_STATUS="$(echo "$FETCHED" | jq -r '.evidence_confidence // "low"')"
  fi
fi

# Path 2: in-workflow service-role collect (preferred when CTO_OUTCOME_SECRET unset)
if [[ "$OUTCOME_ACCESS" != "ok" && "$OUTCOME_ACCESS" != "zero_activity" && "$OUTCOME_ACCESS" != "stale" ]]; then
  if [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" && -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
    if npx --yes tsx scripts/collect-ceo-evidence.ts "$CEO_EVIDENCE_PATH" 2>/tmp/ceo-collect.err; then
      OUTCOMES_JSON="$(jq '.outcomes // {}' "$CEO_EVIDENCE_PATH")"
      OUTCOME_ACCESS="$(jq -r '.outcome_access // "unavailable"' "$CEO_EVIDENCE_PATH")"
      OUTCOMES_STATUS="$(jq -r '.evidence_confidence // "low"' "$CEO_EVIDENCE_PATH")"
    else
      echo "ceo collect fallback failed: $(head -c 200 /tmp/ceo-collect.err 2>/dev/null || true)" >&2
      OUTCOME_ACCESS="unavailable"
      OUTCOMES_STATUS="low"
    fi
  fi
fi

if [[ "$OUTCOMES_STATUS" == "ok" || "$OUTCOMES_STATUS" == "high" || "$OUTCOMES_STATUS" == "medium" ]]; then
  if [[ -n "$SECRET" ]]; then
    bash "$ROOT/scripts/cto-outcome-pipeline.sh" 2>/dev/null || true
  fi
fi

# Business risk flags (no Supabase required)
RISKS=()
[[ "$SHA_PARITY" == "false" ]] && RISKS+=("production_sha_drift")
[[ "$HEALTH_OK" != "true" ]] && RISKS+=("booking_health_degraded")
[[ "$OUTCOME_ACCESS" == "unauthorized" || "$OUTCOME_ACCESS" == "unavailable" ]] && RISKS+=("outcome_metrics_unavailable")
[[ "$OUTCOME_ACCESS" == "stale" ]] && RISKS+=("outcome_pipeline_stale")

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
  --arg access "$OUTCOME_ACCESS" \
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
        outcome_access: $access,
        ci_automation: "github_actions"
      },
      long_term: {
        evidence_based_decisions: ($access == "ok" or $access == "zero_activity")
      }
    },
    deployment: {
      repository_commit: $repo,
      repository_full: $repo_full,
      production_commit: $prod,
      sha_parity: $parity
    },
    outcomes: $outcomes_data,
    outcome_access: $access,
    top_risks: $risks
  }' > "$OUT"

# Embed full CEO contract into outcomes when available (operator artifact path)
if [[ -f "$CEO_EVIDENCE_PATH" ]]; then
  jq --slurpfile ceo "$CEO_EVIDENCE_PATH" \
    '. + {ceo_evidence: $ceo[0]} | .outcomes = (.outcomes + {outcome_access: $ceo[0].outcome_access, evidence_confidence: $ceo[0].evidence_confidence})' \
    "$OUT" > "${OUT}.tmp" && mv "${OUT}.tmp" "$OUT"
fi

echo "Business snapshot → $OUT"
echo "  repo=$REPO_SHORT prod=$PROD_SHA parity=$SHA_PARITY access=$OUTCOME_ACCESS confidence=$OUTCOMES_STATUS"
echo "  risks: $(jq -r '.top_risks | join(", ")' "$OUT")"
