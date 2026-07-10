# Disaster Recovery Plan

**Sunrise Cafe** · Phase 4

## Critical assets

| Asset | Location | RPO | RTO |
|-------|----------|-----|-----|
| PostgreSQL (Supabase) | Supabase cloud | Point-in-time (Pro plan) / daily backup (Free) | < 4h |
| Application code | GitHub `main` | 0 (git) | < 1h redeploy |
| Secrets | Vercel env + local `.env.local` | Manual export | < 1h |
| LINE channel config | LINE Developers Console | Manual | < 2h |

## Failure scenarios

### 1. Vercel outage
- **Impact:** Site unavailable
- **Response:** Monitor [vercel-status.com](https://www.vercel-status.com); no code change possible until recovery
- **Mitigation:** Status page communication to staff

### 2. Supabase pause (free tier idle 7d)
- **Impact:** All DB APIs fail
- **Response:** Dashboard → Restore project; verify migrations via `scripts/verify-migrations.sh`
- **Prevention:** Weekly cron or uptime ping keeps project active

### 3. Bad deployment
- **Response:** Vercel → Deployments → Promote previous production
- **Prevention:** CI (lint, test, build, E2E); draft PRs; `docs/RELEASE.md` checklist

### 4. LINE token compromise
- **Response:** Rotate `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CUSTOMER_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`; update webhook URL on new channel if needed
- **Reference:** `CLAUDE.md` dual-channel section

## Backup verification (quarterly)

1. Export sample `reservations` count from Supabase SQL editor
2. Confirm Vercel env vars documented (not values) in team password manager
3. Run `npm test` + `npm run test:e2e` on `main`
4. Restore drill: create Supabase branch DB from backup (if on Pro)

## Contacts

Document store LINE group admins and Supabase project owner in team runbook (outside repo).
