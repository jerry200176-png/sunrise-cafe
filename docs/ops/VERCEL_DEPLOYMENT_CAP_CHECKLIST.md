# Vercel deployment-cap checklist (Founder dashboard)

This checklist is intentionally account-level. Repository code cannot remove a
second Vercel project, change billing, or repair an integration owned by the
Vercel account.

## One-time dashboard cleanup

- [ ] In Vercel, list every project connected to `jerry200176-png/sunrise-cafe`.
- [ ] Keep one canonical production project for `sunrise-cafe-six.vercel.app`.
- [ ] For any duplicate project (currently visible in GitHub checks as
      `sunrise-cafe-pklg`), disable or disconnect its Git production/preview
      deployment integration after confirming it has no required domain,
      environment variable, cron, or production traffic.
- [ ] On the canonical project, confirm Production Branch is `main` and the
      repository Ignored Build Step is `bash scripts/vercel-ignored-build.sh`.
- [ ] Confirm only the canonical project owns production domains, production
      environment variables, and Vercel Cron schedules.
- [ ] Review recent deployments for `api-deployments-free-per-day` or
      `build-rate-limit` failures and record the cleanup timestamp.

## Post-cleanup verification

- [ ] Confirm one Vercel status context is reported for a test PR.
- [ ] Confirm a main push has one production deploy owner in GitHub Actions:
      `Production deploy and migrate`.
- [ ] Confirm `Verify Production` only polls and probes; it must not create a
      Vercel deployment.
- [ ] Confirm `/api/version` on `https://sunrise-cafe-six.vercel.app` matches
      `origin/main` after the next code-bearing main deployment.

Do not upgrade the Vercel plan as the first response. Complete this checklist
and review the repository-controlled safeguards in this PR first.
