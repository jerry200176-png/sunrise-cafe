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

close_issue 61 "**Closed by github-hygiene** — shipped AI-readable workflow docs.

- \`docs/workflows/README.md\` — booking, payment, waitlist, admin, cron flows
- Living issue registry: \`docs/GITHUB_ISSUE_STATUS.md\`"

close_issue 63 "**Closed (deferred)** — tracked in \`docs/CAPABILITY_GAPS.md\` CG-003 area.

No PaymentProvider contract until gateway integration (#99) is approved.
Re-open when Stripe/LINE Pay integration begins."

echo "Open issues:"
gh issue list --state open --limit 20 || true
