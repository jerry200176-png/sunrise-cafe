# Security Review Checklist

Use before major releases and quarterly.

## Authentication & authorization

- [ ] `ADMIN_PASSWORD` set in production Vercel
- [ ] `SESSION_SECRET` distinct from password (recommended)
- [ ] Admin APIs return 401 without valid session (`requireAdminApiAuth`)
- [ ] Guest cancel/reschedule requires `phone` + `booking_code`
- [ ] LINE `line_user_id` only from httpOnly cookie (not client body)

## Data & privacy

- [ ] Analytics events contain no phone/name/email (`analytics-events.ts` allowlist)
- [ ] `payment_events` RLS blocks anon access
- [ ] Customer insights API returns aggregates only
- [ ] No secrets in git (`gitleaks` CI passing)

## API & infrastructure

- [ ] Rate limiting configured (Upstash) or documented fail-open
- [ ] Cron routes verify `CRON_SECRET` or admin session
- [ ] Webhook LINE signature validation enabled
- [ ] `npm audit` reviewed (high+)

## Operational

- [ ] Supabase migrations applied and recorded in `schema_migrations`
- [ ] `npm run verify:migrations` passes in CI
- [ ] `GET /api/admin/schema/status` shows `drift: false` after deploy
- [ ] Phase 6 scale indexes applied (`migration-phase6-scale-indexes.sql`)
- [ ] Analytics retention function deployed; monthly cron configured
- [ ] Upstash rate limiting set in production (not fail-open)
- [ ] Sentry DSN configured for production error tracking
- [ ] Previous deployment rollback path tested on Vercel

## Phase 6 governance

- [ ] New contributors read `docs/ONBOARDING.md` + `docs/AI_AGENT_GOVERNANCE.md`
- [ ] P0 catalog API auth gaps tracked (`SECURITY_MATURITY_PHASE6.md`)
- [ ] `SESSION_SECRET` distinct from `ADMIN_PASSWORD`

## Sign-off

| Role | Date | Notes |
|------|------|-------|
| Engineer | | |
| Operator | | |
