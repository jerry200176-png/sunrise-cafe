# Sunrise Cafe — Principal Engineering Assessment

**Date:** 2026-07-10  
**Assessor role:** Principal Engineer / Technical Owner  
**Production URL:** https://sunrise-cafe-six.vercel.app  
**Baseline commit:** `main` @ `6b1d179`

---

## Executive Summary

Sunrise Cafe is a **mature small-business monolith** with unusually strong documentation for its size (CLAUDE.md, ADRs, runbooks, payment state model). Core booking, payment, waitlist, and LINE integrations are functional and partially tested. The system can support **hundreds of concurrent customers** today but has **critical authorization gaps** and **data-integrity race conditions** that must be closed before scaling to thousands or handling adversarial traffic.

**Verdict:** Production-viable for a single multi-room café with operational oversight. **Not yet production-grade** for unattended commercial growth without the P0 fixes in this sprint.

| Lens | Grade | One-line summary |
|------|-------|------------------|
| CTO | B− | Strong product-market fit tooling; security debt blocks scale |
| Staff Engineer | B | Good lib extraction + tests; API auth inconsistent |
| Product Engineer | B+ | Rich booking/payment UX; waitlist hidden, i18n partial |
| SRE | C+ | Sentry + crons exist; no health SLOs, manual migrations |

---

## 1. Architecture Overview

```
┌─────────────┐     ┌──────────────────────────────────────┐
│   Guest     │────▶│  Next.js 15 (Vercel Serverless)      │
│   Browser   │     │  middleware → API routes → src/lib   │
└─────────────┘     └──────────┬───────────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
┌─────────────┐        ┌─────────────┐        ┌─────────────┐
│  Supabase   │        │ LINE (2 ch) │        │ Upstash RL  │
│  PG + RT    │        │ Webhook/OAuth│       │ Sentry      │
└─────────────┘        └─────────────┘        └─────────────┘
       ▲
       │ Realtime orders
┌─────────────┐
│print-bridge │  (store PC, not Vercel)
└─────────────┘
```

**Strengths**
- Business logic concentrated in `src/lib/` with Vitest coverage on payment, booking, datetime, auth
- Defense-in-depth admin auth pattern (`middleware` + `requireAdminApiAuth`) for reservation mutations (RC2 P1/P2)
- Database-driven payment copy (`branches.display_name`, `payment_info`, `line_pay_url`)
- Multi-branch LINE reminders via `branches.line_group_id`
- Documented timezone trap and Taipei conversion helpers

**Weaknesses**
- Page-centric frontend (all `"use client"`, no RSC data layer)
- Manual SQL migrations with no runner or version tracking in DB
- Mixed Supabase access patterns (`supabase-admin`, `supabase-fetch`, raw REST)
- `schema.sql` is destructive (drops tables) — dangerous for ops

---

## 2. Findings by Priority

### P0 — Production / Security / Data Risks

| ID | Finding | Impact | Status |
|----|---------|--------|--------|
| P0-1 | `POST /api/branches`, `POST/PATCH/DELETE /api/rooms` unauthenticated | Anyone can mutate catalog/pricing | **Fixing** |
| P0-2 | `POST /api/reservations` accepts client `status`, `total_price` | Forge confirmed bookings, skip deposit | **Fixing** |
| P0-3 | `POST /api/reservations/recurring` unauthenticated | Bulk-create 4–12 weeks of reservations | **Fixing** |
| P0-4 | Admin auth fail-open when `ADMIN_PASSWORD` unset | All admin APIs open if misconfigured | **Fixing** |
| P0-5 | `/api/diagnose` public with env/error details | Information disclosure | **Fixing** |
| P0-6 | Phone-only guest auth (query/cancel/reschedule) | IDOR: know phone → control bookings | Planned P1 |
| P0-7 | Double-booking race (read-then-write, no DB lock) | Two guests same slot | Planned P1 |
| P0-8 | Legacy RLS `anon FOR ALL` if migration not applied | Direct DB mutation bypass | Ops checklist |
| P0-9 | Text payment keywords auto-mark `is_deposit_paid` | False-positive payment confirmation | ADR-008 partial |
| P0-10 | `headersAdmin()` falls back to anon key | Silent privilege downgrade | Planned P1 |

### P1 — High Business Impact

| ID | Finding | Business impact |
|----|---------|-----------------|
| P1-1 | Waitlist not linked from `/book` when full | Lost conversions when rooms sell out |
| P1-2 | Partial i18n (success, order, admin in Chinese only) | International guest friction |
| P1-3 | No booking progress indicator | Abandonment on 5-step wizard |
| P1-4 | Weekend pricing uses UTC `.getDay()` in some server paths | Wrong pricing on boundary dates |
| P1-5 | Waitlist marks `notified` even if LINE fails | Guests never notified, slot empty |
| P1-6 | No waitlist chain after 30min expiry | Manual ops to fill freed slots |
| P1-7 | Hardcoded production URLs in `line.ts` | Staging/custom domain breakage |
| P1-8 | Admin hub is 960-line monolith | Slow ops, error-prone |
| P1-9 | Dashboard fires 7 parallel API calls per date change | Slow mobile admin |
| P1-10 | `CRON_SECRET` optional | Cron endpoints callable if password unset |

### P2 — Engineering Improvements

| ID | Finding |
|----|---------|
| P2-1 | No `loading.tsx` / `error.tsx` route segments |
| P2-2 | No `dynamic()` for Recharts (admin reports bundle) |
| P2-3 | CI: `npm audit` and gitleaks `continue-on-error: true` |
| P2-4 | Thin E2E (page-load smoke only) |
| P2-5 | No API integration test suite beyond one route |
| P2-6 | ADR-003 outdated (multi-branch reminders shipped) |
| P2-7 | `Math.random()` booking codes (collision → 500, no retry) |
| P2-8 | Duplicate `isWeekend()` in components vs server |
| P2-9 | No structured logging (console.error only) |
| P2-10 | No migration version table / automated apply |

### P3 — Future Enhancements

| ID | Finding |
|----|---------|
| P3-1 | RBAC / per-user admin accounts |
| P3-2 | SMS OTP for guest booking management |
| P3-3 | Postgres exclusion constraint for slot locking |
| P3-4 | LINE Pay API integration (see LINE_PAY_INTEGRATION.md) |
| P3-5 | Signed OAuth state for `line_user_id` binding |
| P3-6 | Business metrics dashboard (conversion, deposit rate, no-show) |
| P3-7 | Automated Supabase backups beyond PowerShell script |
| P3-8 | print-bridge CI and health monitoring |

---

## 3. Multi-Perspective Review

### CTO — "Could this support thousands of customers?"

**Booking throughput:** Rate limits (5/min booking, 30/min availability) protect abuse but fail-open without Upstash. Concurrent booking race can double-book under load — unacceptable at scale.

**Revenue risk:** Client-controlled `status`/`total_price` on create (P0-2) is a direct financial integrity issue.

**Operational risk:** Manual migrations mean production schema drift is likely over time. `payment_events` migration explicitly requires post-deploy manual SQL.

**Recommendation:** Ship P0 auth hardening immediately. Plan P1 slot locking + guest OTP before marketing push.

### Staff Engineer — Code Quality

**Good:** `src/lib/payment-events.ts`, `deposit-deadline.ts`, `admin-api-auth.ts` are well-factored with tests. ADR trail prevents accidental rewrites.

**Bad:** API routes vary in auth patterns — some rely on middleware only, some have handler guards, some have neither. `isAdminOnlyApiPath` was incomplete for branches/rooms.

**Recommendation:** Single source of truth for admin path registry; handler-level `requireAdminApiAuth` on every mutating route.

### Product Engineer — UX

**Customer journey:** Landing → 5-step book → success → query is functional. LINE bind and deposit UI on query page are strong.

**Friction:** Waitlist exists but is undiscoverable. Design system split (editorial landing vs amber/gray booking). Debug links to `/api/booking-health` exposed to guests.

**Admin:** Feature-rich but monolithic. `alert()`/`confirm()` for destructive actions. Timeline requires horizontal scroll on mobile.

### SRE — Reliability

**Monitoring:** Sentry (3 runtimes + replay), optional Upstash, `/api/booking-health`, `/api/version`.

**Gaps:** No SLOs, no alerting runbooks tied to metrics, no synthetic checks in CI beyond page load. Cron jobs share one UTC schedule — no stagger for failure isolation.

**Incident history:** `docs/incidents/2026-07-09-vercel-merge-deploy-gap.md` shows awareness; formalize postmortem template.

---

## 4. GitHub & Development Workflow

### Current State

| Area | Status |
|------|--------|
| Branch strategy | `main` + feature branches; no enforced naming |
| CI | Lint + Vitest + build + Playwright smoke on PR/push |
| PRs | RC1/RC2 shipped via PRs (#66 P1 auth) |
| Releases | `docs/releases/RC1.md`, `RC2-P1.md` |
| Issues | Not visible in repo (GitHub Issues external) |
| Dependabot | Active (`dependabot/npm_and_yarn/*` branches) |

### Recommended Improvements

1. **Branch naming:** `cursor/<topic>-<id>` for agents; `feat/`, `fix/`, `ops/` for humans
2. **PR template:** Checklist for migration required?, env var changes?, manual deploy steps?
3. **CI hardening:** Fail on high `npm audit`; gitleaks blocking on main
4. **E2E:** Add `E2E_ADMIN_PASSWORD` to CI secrets for payment review smoke
5. **Release process:** Tag `vX.Y.Z` on main; CHANGELOG section per release
6. **Issue labels:** `P0-security`, `P1-business`, `migration-required`, `ops-manual`
7. **AI maintainability:** Keep CLAUDE.md + ENGINEERING_ASSESSMENT.md updated per sprint

---

## 5. Production Reliability Roadmap

| Capability | Current | Target |
|------------|---------|--------|
| Error handling | try/catch → JSON 500 | Structured errors, no DB leak |
| Logging | console.error | JSON logs + correlation ID |
| Health checks | `/api/booking-health`, `/api/version` | Public minimal + admin detailed |
| DB safety | Manual migrations | Migration runner + `_migrations` table |
| Backups | `scripts/backup-db.ps1` | Scheduled Supabase PITR + test restore |
| Rollback | Vercel promote previous | Documented + migration rollback scripts |
| Incident response | RUNBOOK.md | On-call checklist + severity matrix |

---

## 6. Business Opportunities

| Opportunity | Engineering lever | Metric |
|-------------|-------------------|--------|
| Reduce no-shows | Deposit deadline + LINE reminders (exists) | `cancelled` rate pre-visit |
| Increase fill rate | Surface waitlist CTA on full slots | Waitlist → booked conversion |
| Reduce ops time | Complete payment review workflow (screenshot-only) | Manual payment checks/week |
| Retention | Google review invite on checkout (exists) | Review count |
| Revenue | Dynamic pricing / peak hours | RevPAR per room-hour |
| Automation | Bank CSV reconcile (exists in admin) | Unmatched payments |

---

## 7. This Sprint — Implemented Fixes

### P0 Security Hardening (branch `cursor/security-hardening-p0-3a90`)

| Change | Why | Rollback |
|--------|-----|----------|
| Extend `isAdminOnlyApiPath` for branches/rooms/recurring POST | Close unauthenticated catalog mutation | Revert middleware paths |
| Handler-level `requireAdminApiAuth` on branch/room routes | Defense in depth | Revert handlers |
| Reservation POST: force `pending`, server-side price | Prevent forged confirmed bookings | Revert route.ts |
| `isAdminAuthRequired()`: deny in production without password | Close misconfiguration hole | Revert admin-api-auth.ts |
| Restrict `/api/diagnose` to admin | Stop env/error disclosure | Revert route |
| `computeReservationTotalPrice()` in booking-utils | Single price source + Taipei weekend | Revert lib |

**Pre-deploy checklist:**
- [ ] `ADMIN_PASSWORD` set in Vercel production
- [ ] `SESSION_SECRET` set (recommended)
- [ ] `CRON_SECRET` set
- [ ] `migration-rls-reservations-insert-only.sql` applied
- [ ] `migration-payment-events.sql` applied

---

## 8. Next Sprint Priorities

1. **P1-6 / P1-7:** Guest auth with booking_code + rate limits; signed LINE OAuth state
2. **P0-7:** Postgres exclusion constraint or `book_slot` RPC with advisory lock
3. **P1-1:** Waitlist CTA on `/book` when slot unavailable
4. **P1-4:** Audit all server `.getDay()` → `toTaipei()`
5. **P2-3:** CI audit/gitleaks blocking
6. **P2-10:** Migration tracking table + apply script

---

## Appendix: API Route Auth Matrix (post-fix)

| Route | Method | Auth |
|-------|--------|------|
| `/api/reservations` | POST | Public (rate-limited) |
| `/api/reservations` | GET | Admin |
| `/api/reservations/[id]` | PATCH/DELETE | Admin |
| `/api/branches` | POST | Admin |
| `/api/branches/[id]` | PATCH/DELETE | Admin |
| `/api/rooms` | POST | Admin |
| `/api/rooms/[id]` | PATCH/DELETE | Admin |
| `/api/reservations/recurring` | POST | Admin |
| `/api/diagnose` | GET | Admin |
| `/api/booking-health` | GET | Public (minimal) / Admin (detailed) |
