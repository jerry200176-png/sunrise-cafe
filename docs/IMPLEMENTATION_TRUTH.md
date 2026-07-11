# Implementation Truth — Single Source of Technical State

**Owner:** CTO Operating System v2  
**Updated:** 2026-07-11 (Round 9 — guest privacy + rate limits)  
**Rule:** If this doc disagrees with other docs, **this doc wins**. Verify against `main` branch code.  
**Daily ops:** [`EXECUTIVE_DASHBOARD.md`](./EXECUTIVE_DASHBOARD.md) · snapshot: `npm run cto:snapshot`

---

## Production

| Item | Value |
|------|-------|
| URL | https://sunrise-cafe-six.vercel.app |
| Branch | `main` |
| Release tag | `v2.2.0` |
| Verify | `GET /api/version` → `commit` SHA |

---

## Enforced in Code (✅ = on `main`)

| Capability | Status | Evidence |
|------------|--------|----------|
| Admin session on `/api/admin/*` | ✅ | `middleware.ts` |
| Deny-by-default admin in production | ✅ | #69 |
| Server-side booking price/status | ✅ | #69 |
| Guest phone + booking_code auth | ✅ | #79 |
| Double-book app handling | ✅ | #79 |
| RBAC tables + login | ✅ | #81 |
| RBAC payment routes | ✅ | #82 |
| RBAC reservation routes | ✅ | #85 `reservation-access.ts` |
| Per-branch `closed_dates` | ✅ | #86 `branch-closed-dates.ts` |
| Cron failure alerting | ✅ | #87 `cron-alert.ts` |
| Cron job_runs persistence | ✅ | `job-runs.ts` + migration (apply optional) |
| Next.js security patch | 🟡 | #88 → 15.5.20 |
| `verify:migrations` in CI | ✅ | `npm run verify:migrations` + optional drift gate |
| Playwright E2E (mocked flows) | ✅ | `e2e/booking-flow.spec.ts`, `e2e/payment-query.spec.ts` (#59) |
| LINE bind phone verification | ✅ | `line-bind.ts` + webhook/OAuth |
| Payment LINE text → review | ✅ | ADR-008 Phase 2 (`payment-events.ts`) |
| Cron partial-failure alerts | ✅ | `job-runs.ts` + `errors` in deposit-deadline |
| Guest lookup POST (no URL creds) | ✅ | `/api/my-bookings` POST + query page |
| Per-phone guest rate limits | ✅ | `guestRateLimitId` in middleware + routes |
| Structured ops logging | ✅ | `ops-log.ts` (cron + webhook) |

---

## Database Migrations (manual apply)

| Migration | Required | Applied? |
|-----------|----------|----------|
| `migration-schema-versions.sql` | Yes | Operator verify |
| `migration-reservations-no-overlap.sql` | Yes (#79) | Pending |
| `migration-phase7-rbac.sql` | Yes (#81) | Pending |
| `migration-branches-closed-dates.sql` | After #86 | Pending |

Check: `SELECT * FROM schema_migrations ORDER BY applied_at;`

---

## Open GitHub State

| Type | Count | Action |
|------|-------|--------|
| Open PRs | 11 (8 draft phase + #77/#89 + dependabot) | Founder batch close |
| Open Issues | 7 | #62 duplicate; #53 active P1 |
| Tests on main | 141 unit + 7 E2E (1 skip) | verify:migrations in CI |

---

## Priority Stack (company value order)

1. **Production stability** — migrations applied
2. **Security** — ✅ reservation RBAC (#85)
3. **Revenue** — deposit flow, waitlist
4. **Customer experience** — per-branch closed dates (#86)
5. **Developer experience** — dashboard SSOT, snapshot script

---

*Updated each engineering round in `docs/EXECUTIVE_DASHBOARD.md`.*
