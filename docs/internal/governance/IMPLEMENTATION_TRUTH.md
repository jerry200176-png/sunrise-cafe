# Implementation Truth — Single Source of Technical State

**Owner:** CTO Operating System v2  
**Updated:** 2026-07-13 (Round 27 — #181 merged; #178 Flex live on prod `2248d24`)  
**Rule:** If this doc disagrees with other docs, **this doc wins**. Verify against `main` branch code.  
**Daily ops:** [`EXECUTIVE_DASHBOARD.md`](./EXECUTIVE_DASHBOARD.md) · snapshot: `npm run cto:snapshot`

---

## Production

| Item | Value |
|------|-------|
| URL | https://sunrise-cafe-six.vercel.app |
| Branch | `main` |
| `main` SHA | `dc00592` |
| Production SHA | `2248d24` (parity 🟡 — 3 commits behind; **#178 Flex LIVE** on prod; #181 funnel UI awaits deploy) |
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
| Forgot-code recovery (phone + date) | ✅ | `lookupGuestBookingsByDate` · `/book/query` |
| Double-book app handling | ✅ | #79 |
| RBAC tables + login | ✅ | #81 |
| RBAC payment routes | ✅ | #82 |
| RBAC reservation routes | ✅ | #85 `reservation-access.ts` |
| Per-branch `closed_dates` | ✅ | #86 `branch-closed-dates.ts` |
| Cron failure alerting | ✅ | #87 `cron-alert.ts` |
| Cron job_runs persistence | ✅ | `job-runs.ts` + `migration-job-runs.sql` |
| Next.js security patch | 🟡 | #88 → 15.5.20 |
| `verify:migrations` in CI | ✅ | `npm run verify:migrations` + optional drift gate |
| Playwright E2E (mocked flows) | ✅ | 23 pass · `e2e/qa-audit.spec.ts` + booking/payment |
| LINE Flex unified cards | ✅ | `line-cards.ts` + `flexBubble()` (#178) |
| Engineering task wall API | ✅ | `/api/admin/orchestrator` + `cto:task-wall` (#177) |
| OPS-004b funnel dashboard | ✅ | Executive 轉換漏斗 section (#181; prod after deploy) |
| Anti-slop design audit | ✅ | `npm run design:audit` + `HALLMARK_ADOPTION.md` |
| QA multi-device fixes | ✅ | #176 — safe-area, Taipei dates, admin mobile |
| LINE bind phone verification | ✅ | `line-bind.ts` + webhook/OAuth |
| Payment LINE text → review | ✅ | ADR-008 Phase 2 (`payment-events.ts`) |
| Cron partial-failure alerts | ✅ | `job-runs.ts` + `errors` in deposit-deadline |
| Guest lookup POST (no URL creds) | ✅ | `/api/my-bookings` POST + query page |
| Per-phone guest rate limits | ✅ | `guestRateLimitId` in middleware + routes |
| Guest rate limit mode | 🟡 enforced when Upstash env set; **fail-open** otherwise | `rate-limit.ts` `isUpstashConfigured()` |
| Structured ops logging | ✅ | `ops-log.ts` — webhook + Sentry breadcrumbs (#118) |
| Executive BI dashboard | ✅ | `/admin/executive` + `business-snapshot.json` (#116) |
| Query auto-search post-booking | ✅ | `/book/query` prefilled search (#118) |
| Booking wizard stepper/a11y | ✅ | `/book` step progress + aria (#119) |
| Booking form mobile UX | ✅ | CX-008 sticky CTA + field errors + `noValidate` (#153, #156) |
| Dashboard trend single API | ✅ | ADM-005 `/api/admin/stats/trend` (#157) |
| Staff toast/dialog UX | ✅ | ADM-002b/c/d — payments, dashboard, waitlist (#155–#159) |
| Gmail failure scan | ✅ | `npm run gmail:scan` (#151) |
| GitHub hygiene automation | ✅ | `github-hygiene.yml` + `github-hygiene-close.sh` (#120–#122) |
| Staff: no duplicate LINE reminders | ✅ | Manual send-line `force: false` |
| Staff: reservation PATCH error feedback | ✅ | `ReservationList` rollback + alert |
| Staff: payment review evidence UI | ✅ | `/admin/payments` — LINE screenshot proxy when message id stored |
| Guest: query phone prefill | ✅ | `sessionStorage` from booking |

---

## Database Migrations

**Production verified:** 2026-07-12 (Supabase REST against production project; see `scripts/check-migration-drift.mjs`).

| Migration | Required | Applied? |
|-----------|----------|----------|
| `migration-schema-versions.sql` | Yes | ✅ |
| `migration-reservations-no-overlap.sql` | Yes (#79) | ✅ `20260710-reservations-no-overlap` |
| `migration-phase7-rbac.sql` | Yes (#81) | ✅ `20260710-phase7-rbac` |
| `migration-branches-closed-dates.sql` | Yes (#86) | ✅ `closed_dates` column present |
| `migration-job-runs.sql` | Recommended | ✅ `20260711-job-runs` |
| `migration-payment-events.sql` | Yes (ADR-008) | ✅ `payment_events` table present |
| `migration-branches-line-group-id.sql` | Optional (multi-branch LINE) | 🟡 Not applied — env `LINE_GROUP_ID` fallback still works |

Re-verify anytime:

```bash
# Requires production Supabase env (e.g. vercel env pull)
node scripts/check-migration-drift.mjs .env.vercel.prod
```

Or in SQL Editor: `SELECT * FROM schema_migrations ORDER BY applied_at;`

---

## Open GitHub State

| Type | Count | Action |
|------|-------|--------|
| Open PRs | **0** | #177 #178 merged 2026-07-13 |
| Open Issues | **1** | Strategic only: **#99** (integrated deposit capture) |
| Tests on main | **186** unit + **23** E2E (2 skip) | `npm test` · `npm run test:e2e` |
| Governance gate | `cto:governance` | PASS — re-run after doc sync |
| AI orchestrator | `cto:orchestrator` | Task wall + stall-check + failure alchemy (#177) |

---

## Why docs drift (and how we fix it)

Several docs describe the same facts (migrations, SHAs, inbox signals). They go stale when:

1. **Migrations applied in Supabase Dashboard** without a same-day doc PR — code and DB move ahead of `IMPLEMENTATION_TRUTH.md`.
2. **Parallel update surfaces** — `orchestrator/state.json`, `AUTONOMOUS_LOOP_STATE.md`, and `EXECUTIVE_INBOX.md` are updated in different PRs; autonomous `doc-drift-fix` only patches a subset.
3. **Auto-generated snapshots not re-run** — `GOVERNANCE_STATUS.md` / `cto:governance` lag until someone runs the script.
4. **Deploy catch-up** — Vercel Hobby rate limits can delay preview checks while production already matches `main`; inbox may still show SHA drift.

**Prevention:** After any manual Supabase migration or production deploy verification, update this file + `EXECUTIVE_INBOX.md` in the same PR. Use `node scripts/check-migration-drift.mjs` before marking migrations ✅.

---

## Priority Stack (company value order)

1. **Production stability** — ✅ migrations applied; SHA parity
2. **Security** — ✅ reservation RBAC (#85)
3. **Revenue** — deposit flow, waitlist, KPI measurement (OUTCOME_LOG)
4. **Customer experience** — booking mobile UX (#153), per-branch closed dates (#86)
5. **Developer experience** — dashboard SSOT, snapshot script, doc accuracy

---

*Updated each engineering round in `docs/EXECUTIVE_DASHBOARD.md`.*
