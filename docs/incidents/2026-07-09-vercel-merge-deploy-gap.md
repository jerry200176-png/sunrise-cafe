# Incident: Vercel production not updated after merge to main

**Date:** 2026-07-09 (TW)  
**Severity:** Medium (code merged; production stale ~30+ min)  
**Status:** Resolved (manual deploy)  
**Affected release:** RC2 P1 (`3fc7215`)

---

## Summary

PR #66 merged to `main` at 08:33 UTC. GitHub Actions CI passed. **Vercel did not create a production deployment** for merge commit `3fc7215`. Production remained on RC1 (`8c6ca04`) until manual `vercel deploy --prod` at ~09:01 TW.

---

## Timeline

| Time (UTC) | Event |
|------------|--------|
| 08:33:53 | PR #66 merged; `main` → `3fc7215` |
| 08:33:55 | GitHub Actions CI started on `main` — **success** |
| 08:33–08:55 | Production `/api/version` still `8c6ca04` |
| — | No GitHub deployment record for `3fc7215`; commit status **pending** (0 Vercel checks) |
| ~09:01 TW | Manual `vercel deploy --prod` from `main` @ `3fc7215` |
| — | Production live `3fc7215`; deployment `dpl_GcwsnfftVd84T6c7y7YBsyFiT2ux` |

---

## Root cause (probable)

1. **Vercel Git integration did not enqueue a production build** for the merge-commit push to `main` (no deployment object, no commit status).
2. PR **preview** for `ae0236e` built successfully; merge commit `3fc7215` shares the **same git tree** as `ae0236e` — Vercel may have skipped redundant production promotion (dedup behavior; not confirmed in dashboard).
3. **Not** a CI failure, code defect, or Supabase issue.

---

## Impact

- RC2 P1 security fixes (PATCH/DELETE auth) **not live** during gap.
- Unauthenticated reservation mutation remained possible on production until manual deploy.
- No data corruption; no env var changes.

---

## Resolution

```bash
git checkout main && git pull
vercel deploy --prod --yes
```

Verified: `/api/version` → `3fc7215`, PATCH no-auth → 401.

---

## Prevention

1. **Post-merge verification workflow** — `.github/workflows/verify-production.yml` polls `/api/version` vs `github.sha` after push to `main`.
2. **RUNBOOK** — "Merged but not live" recovery section (manual deploy + promote).
3. **Release checklist** — confirm `/api/version` SHA before marking release done.
4. **Vercel dashboard** (operator): Settings → Git → confirm Production Branch = `main`, review Ignored Build Step, inspect webhook delivery for merge pushes.

---

## Rollback reference

If RC2 P1 must be reverted: promote `dpl_iyt6jVxsEa7L2WLak1c7YAQWLUdY` (RC1 / `8c6ca04`).
