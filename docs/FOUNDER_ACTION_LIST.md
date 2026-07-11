# Founder Action List

**Updated:** 2026-07-11 15:40 CST  
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

## KPI baseline (unblocks outcome scores)

1. Open https://sunrise-cafe-six.vercel.app/admin/executive once (logged in)
2. Record metrics in [`OUTCOME_LOG.md`](./OUTCOME_LOG.md)

## Secrets (optional automation)

| Secret | Where | Enables |
|--------|-------|---------|
| `CTO_OUTCOME_SECRET` | Vercel + GitHub Actions | Auto-sync `OUTCOME_LOG.md` via business-intelligence workflow |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions | Live DB drift gate + outcome metrics |
| Upstash Redis | Vercel | Rate limits enforce in prod (CG-006) |

---

_After completing actions, run `npm run cto:governance` — gate should move toward PASS._
