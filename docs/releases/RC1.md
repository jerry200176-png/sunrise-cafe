# RC1 — Payment Review & Production Reliability

**Release date:** 2026-07-09 (TW)  
**Status:** Shipped  
**Production URL:** https://sunrise-cafe-six.vercel.app

---

## Production SHA

| Field | Value |
|-------|--------|
| **Commit** | `8c6ca0462b7960b789aee77ed4420d0e684f22a3` (short: `8c6ca04`) |
| **Previous** | `7e1df14` |
| **CI run** | [actions/runs/29003171444](https://github.com/jerry200176-png/sunrise-cafe/actions/runs/29003171444) |

---

## Deployment status

| Check | Result |
|-------|--------|
| Vercel production | Live at RC1 SHA (`/api/version` confirmed) |
| Lint & Build CI | Success |
| Playwright smoke CI | Success |
| Dependabot | Auto-triggered post-push (informational) |

---

## Migration status

| Item | Status |
|------|--------|
| `payment_events` table | Applied (2026-07-09) |
| RLS | Enabled — `service_all_payment_events` policy |
| Indexes | `idx_payment_events_reservation_id`, `idx_payment_events_pending_review` |
| Anon access | INSERT blocked (`42501`); SELECT returns 0 rows |

---

## Scope (#56–#62)

- Admin payment review queue (`/admin/payments`)
- Branch-driven guest payment UI (`my-bookings`, `book/query`)
- CSV reconciliation MVP (suggest-only)
- Structured payment logs (`payment-log.ts`)
- Dependabot + npm audit + gitleaks in CI
- Playwright smoke tests

---

## Verification results (post-deploy)

| Test | Result |
|------|--------|
| `/api/version` | RC1 SHA |
| `/api/booking-health` | OK |
| `/book`, `/book/query` | HTTP 200 |
| `/admin/payments` | Auth redirect (307) |
| `/api/admin/payments/migration-status` | 401 without session |
| `payment_events` integration | Service role OK |
| Booking `8JIT5N` | `cancelled` (pre-release action) |
| Booking `4EAM56` | `cancelled` (pre-release action) |
| Booking `613EN7` | `confirmed` + operator hold |

---

## Operator actions completed pre-release

1. Supabase migration applied
2. Stale bookings reviewed; 8JIT5N/4EAM56 cancelled; 613EN7 held
3. RC1 committed and pushed

---

## Known limitations (carry to RC2)

- `PATCH /api/reservations/[id]` not behind admin session
- Text LINE keywords still auto-mark paid (ADR-008 transitional)
- No audit table for payment status changes
- E2E does not cover full payment review flow

---

## Rollback

```bash
# Vercel Dashboard → Promote deployment 7e1df14
# Do NOT drop payment_events table (audit data)
```
