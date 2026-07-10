# Phase 2 — Production Reliability + Business Growth Sprint

**Date:** 2026-07-10  
**Baseline:** RC3-P0 (`cursor/security-hardening-p0-3a90`)  
**Owner:** Principal Engineer

---

## Sprint Goals

Close the highest business-impact and risk-reduction gaps identified in `docs/ENGINEERING_ASSESSMENT.md`, in strict priority order.

| Phase | ID | Deliverable | Business impact | Risk reduction |
|-------|-----|-------------|-----------------|----------------|
| 1 | P1-1 | Guest auth hardening | Trust, legal/compliance | **Critical** — stops IDOR / enumeration |
| 2 | P1-2 | Booking concurrency | Revenue integrity | **Critical** — no double booking |
| 3 | P1-3 | Waitlist CTA + empty states | +fill rate, +conversions | Medium |
| 4 | P1-4 | Timezone audit | Correct pricing/reminders | High — financial accuracy |
| 5 | P1-5 | CI, migrations, monitoring | Ops velocity | Medium — prevents regressions |

---

## P1-1 — Guest Authentication Hardening

### Implementation

| Component | Change |
|-----------|--------|
| `src/lib/guest-auth.ts` | `normalizePhone`, `normalizeBookingCode`, `verifyGuestBooking`, generic errors |
| `src/lib/supabase-admin.ts` | `fetchReservationByPhoneAndCode` |
| `src/app/api/my-bookings/route.ts` | Require `phone` + `booking_code` |
| `src/app/api/cancel-booking/route.ts` | Require `phone` + `booking_code`; verify match |
| `src/app/api/reschedule-booking/route.ts` | Require `booking_code`; verify match |
| `src/lib/rate-limit.ts` | `guestLookup` bucket: 10/min per IP |
| `src/middleware.ts` | Apply `guestLookup` to guest mutation/lookup paths |
| `src/app/book/query/page.tsx` | Booking code input field |
| `src/lib/i18n/translations.ts` | New copy for booking code field |

### Risk assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Users forget booking code | Medium | Success page already prompts save; query form helper text |
| Breaking existing bookmarks with phone-only | Low | Intentional security trade-off |
| Rate limit false positives | Low | 10/min generous for legitimate use |

### Expected business impact

- Eliminates phone-number enumeration of all active bookings
- Prevents unauthorized cancel/reschedule by phone alone
- **Metric:** guest API abuse attempts blocked (429/404 rate)

### Testing strategy

- Unit: phone/code normalization, verifyGuestBooking logic (mocked DB)
- Attack scenarios: wrong code, wrong phone, phone-only lookup, ID mismatch
- Manual: success page → query with code → cancel/reschedule

---

## P1-2 — Booking Concurrency Protection

### Decision (see ADR-010)

**PostgreSQL exclusion constraint** + existing app conflict check as defense in depth.

### Implementation

| Component | Change |
|-----------|--------|
| `supabase/migration-reservations-no-overlap.sql` | `btree_gist` + exclusion constraint |
| `src/lib/supabase-admin.ts` | Map exclusion violation → conflict error |
| `docs/DECISIONS.md` | ADR-010 |

### Risk assessment

| Risk | Mitigation |
|------|------------|
| Migration fails on existing overlaps | Pre-migration overlap check query in migration comments |
| Insert error message opaque | Parse Postgres error code `23P01` |

### Rollback

Drop constraint `reservations_no_overlap_excl`.

---

## P1-3 — Booking Conversion Improvement

### Implementation

- Waitlist CTA when room/slot unavailable on `/book`
- Improved empty-state copy with alternative dates suggestion
- Mobile-friendly CTA button

### Metrics

- Track `waitlist_join_clicked` (future analytics hook)
- Monitor waitlist POST volume vs full-slot views

---

## P1-4 — Timezone Reliability Audit

### Files to fix

| File | Issue |
|------|-------|
| `reservations/[id]/route.ts` | UTC `getDay()` |
| `waitlist/confirm/route.ts` | UTC `getDay()` |
| `reservations/recurring/route.ts` | UTC `getDay()` |
| `reservations/recurring/admin/route.ts` | UTC `getDay()` |
| `book/page.tsx` | Client weekend check |
| `AddReservationForm.tsx`, `ReservationList.tsx` | Use shared `isWeekendDate` |

---

## P1-5 — Production Engineering Upgrade

### Implementation

| Item | Change |
|------|--------|
| CI | Remove `continue-on-error` for gitleaks; keep audit advisory |
| Migrations | `supabase/migration-schema-versions.sql` + `scripts/migration-status.sql` |
| Error boundaries | `src/app/book/error.tsx`, `src/app/book/loading.tsx` |
| Docs | Update RUNBOOK with Phase 2 deploy steps |

---

## Execution Order

Each item ships as a separate commit with validation (tests + build) before moving to the next.
