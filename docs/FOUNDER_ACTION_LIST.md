# Founder Action List

**Updated:** 2026-07-11 14:09 CST  
**Source:** `npm run cto:governance` — permission-blocked items only

---

## GitHub batch (bot cannot close issues/PRs)

Copy-paste in GitHub UI or local `gh` with your auth:

```bash
# Close completed / duplicate issues
gh issue close 59 --comment "Shipped: E2E in PR #97 (14208d6). 7 Playwright tests on main."
gh issue close 62 --comment "Duplicate: bank CSV reconcile MVP at /api/admin/payments/reconcile."

# Close superseded draft PRs (#70–#77, #89)
for pr in 70 71 72 73 74 75 76 77 89; do
  gh pr close $pr --comment "Governance: superseded by main. See ENGINEERING_GOVERNANCE.md."
done

# Reject dependabot major bumps (DL-012)
gh pr close 90 --comment "Reject: production major bumps need manual QA."
gh pr close 91 --comment "Reject: dev major bumps bundled; review separately."

# Optional: close inbox doc-only PR if still open
# gh pr close 89
```

## Ops (P0 — blocks outcome measurement)

See issue **#95** and [`OPS_MIGRATION_RUNBOOK.md`](./OPS_MIGRATION_RUNBOOK.md) Steps 1–4 (~25 min).

## Deploy (P0 — orchestrator STANDBY until done)

Production SHA lags `main`. Orchestrator is **not LIVE** until matched.

\`\`\`bash
git checkout main && git pull
vercel deploy --prod --yes
curl -s https://sunrise-cafe-six.vercel.app/api/version | jq .commit
# Must equal: git rev-parse HEAD
\`\`\`

Reason: Vercel rate limit / merge-deploy gap (see `docs/AUTONOMY_STATUS.md`).

## KPI baseline (unblocks outcome scores)

1. Open https://sunrise-cafe-six.vercel.app/admin/executive once (logged in)
2. Record metrics in [`OUTCOME_LOG.md`](./OUTCOME_LOG.md)

## Secrets (optional automation)

| Secret | Where | Enables |
|--------|-------|---------|
| `VERCEL_TOKEN` | GitHub Actions | `deploy.sh` prod deploy from loop |
| `OPENAI_API_KEY` | GitHub Actions | `codex-agent.sh` novel implementation |
| `CTO_OUTCOME_SECRET` | Vercel | Outcome pipeline |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions (drift gate) | Doc drift against live DB |
| Upstash Redis | Vercel | Rate limits enforce in prod |

---

_After completing actions, run `npm run cto:governance` — gate should move toward PASS._
