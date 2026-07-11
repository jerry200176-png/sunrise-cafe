# Founder Action List

**Updated:** 2026-07-11 15:40 CST  
**Source:** `npm run cto:governance` — permission-blocked items only

---

## GitHub batch

**Agent-automated (2026-07-11):**
- Closed PRs #70–#77, #89, #90, #91, #112 (superseded / Dependabot majors)
- Deleted stale `cursor/*` remote branches

**Automated via workflow:** `.github/workflows/github-hygiene.yml` closes issues #59, #62, #60 with evidence comments (weekly + manual dispatch).

**Founder one-time (if workflow not yet run):**

```bash
gh workflow run github-hygiene.yml
```

**Manual fallback (if Actions blocked):**

```bash
gh issue close 59 --comment "Shipped: E2E on main (#97, #118)."
gh issue close 62 --comment "Duplicate: reconcile MVP at /api/admin/payments/reconcile."
gh issue close 60 --comment "Shipped: webhook observability #118."
```

## Ops (P0 — blocks outcome measurement)

See issue **#95** and [`OPS_MIGRATION_RUNBOOK.md`](./OPS_MIGRATION_RUNBOOK.md) Steps 1–4 (~25 min).

## KPI baseline (unblocks outcome scores)

1. Open https://sunrise-cafe-six.vercel.app/admin/executive once (logged in)
2. Record metrics in [`OUTCOME_LOG.md`](./OUTCOME_LOG.md)

## GitHub Actions PR create (unblocks autonomous loop merge)

Repo **Settings → Actions → General → Workflow permissions** → enable  
**Allow GitHub Actions to create and approve pull requests**.

Without this, the loop pushes branches but cannot open PRs (exit 2 — expected, not a failure).

## Secrets (optional automation)

| Secret | Where | Enables |
|--------|-------|---------|
| `E2E_ADMIN_PASSWORD` | GitHub Actions | Admin payment review Playwright smoke (CG-007) |
| `CTO_OUTCOME_SECRET` | Vercel + GitHub Actions | Auto-sync `OUTCOME_LOG.md` via business-intelligence workflow |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions | Live DB drift gate + outcome metrics |
| Upstash Redis | Vercel | Rate limits enforce in prod (CG-006) |

---

_After completing actions, run `npm run cto:governance` — gate should move toward PASS._
