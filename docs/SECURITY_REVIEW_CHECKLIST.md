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
- [ ] Sentry DSN configured for production error tracking
- [ ] Previous deployment rollback path tested on Vercel

## Sign-off

| Role | Date | Notes |
|------|------|-------|
| Engineer | | |
| Operator | | |
