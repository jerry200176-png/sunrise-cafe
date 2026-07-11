#!/usr/bin/env bash
# Close triaged GitHub issues with evidence comments.
# Used by .github/workflows/github-hygiene.yml (GITHUB_TOKEN with issues: write)

set -euo pipefail

DRY_RUN="${DRY_RUN:-false}"

close_issue() {
  local num="$1"
  local body="$2"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] would close issue #$num"
    return 0
  fi
  local state
  state="$(gh issue view "$num" --json state -q .state 2>/dev/null || echo unknown)"
  if [[ "$state" != "OPEN" ]]; then
    echo "Issue #$num already $state — skip"
    return 0
  fi
  gh issue close "$num" --comment "$body"
  echo "Closed issue #$num"
}

close_issue 59 "**Closed by github-hygiene workflow** — evidence on \`main\`:

- Playwright E2E: \`e2e/critical-flows.spec.ts\` (public + admin smoke)
- Shipped: #97, expanded #118
- Optional CI: set \`E2E_ADMIN_PASSWORD\` repo secret

See \`docs/GITHUB_TRIAGE.md\`."

close_issue 62 "**Closed by github-hygiene workflow** — duplicate scope.

Bank CSV reconcile MVP: \`/api/admin/payments/reconcile\` + admin UI.

See \`docs/PAYMENT_STATE_MODEL.md\`."

close_issue 60 "**Closed by github-hygiene workflow** — webhook observability on \`main\`:

- \`webhook.event_ok\` / \`webhook.event_error\` / \`webhook.event_handled\` in \`src/lib/ops-log.ts\`
- Sentry breadcrumbs when \`NEXT_PUBLIC_SENTRY_DSN\` set (#118)
- Cron: \`job-runs.ts\` structured logging"

echo "Open issues:"
gh issue list --state open --limit 20 || true
