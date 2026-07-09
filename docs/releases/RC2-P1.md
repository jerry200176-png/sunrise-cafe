# RC2 P1 — Secure Reservation Mutations & Payment Audit (Phase A)

**Release date:** 2026-07-09 (TW)  
**Status:** Shipped  
**Production URL:** https://sunrise-cafe-six.vercel.app

---

## Production SHA

| Field | Value |
|-------|--------|
| **Merge commit** | `3fc7215d3bc0681b2ae8dd3fe7b453c82e5cbf4e` (short: `3fc7215`) |
| **Feature commit** | `ae0236ef84551e347b88066456bf7d8332243c57` (`ae0236e`) |
| **Previous (RC1)** | `8c6ca0462b7960b789aee77ed4420d0e684f22a3` (`8c6ca04`) |
| **PR** | [#66](https://github.com/jerry200176-png/sunrise-cafe/pull/66) |
| **CI run** | [actions/runs/29004528125](https://github.com/jerry200176-png/sunrise-cafe/actions/runs/29004528125) (PR), [29005167941](https://github.com/jerry200176-png/sunrise-cafe/actions/runs/29005167941) (merge) |
| **Production deployment** | `dpl_GcwsnfftVd84T6c7y7YBsyFiT2ux` (manual CLI recovery — see incident doc) |

---

## Scope

### P1.1 — Secure reservation mutations
- `requireAdminApiAuth()` shared guard (`src/lib/admin-api-auth.ts`)
- Middleware + handler protection for `PATCH`/`DELETE` `/api/reservations/[id]`
- Guest `POST /api/reservations` remains public

### P1.2 — Exposure audit
- Documented unauthenticated endpoints; follow-up in RC2 P2 (not in this release)

### P1.3 — Payment audit logging (Phase A)
- `logDepositStatusChange()` structured logs (no DB migration)
- Wired: admin PATCH, payment approve, LINE text webhook, deposit-deadline cron

---

## Verification (post-deploy)

| Test | Result |
|------|--------|
| `/api/version` | `3fc7215…` |
| `PATCH /api/reservations/[id]` no auth | **401** |
| `DELETE /api/reservations/[id]` no auth | **401** |
| `/book`, `/book/query`, `/api/branches` | **200** |
| `/api/booking-health` | `ok: true` |
| Vitest | 80/80 pass |

---

## Known limitations (RC2 P2)

- `GET /api/reservations?branchId=` — PII exposure without auth (fixed in RC2 P2)
- `POST /api/reservations/send-line`, `recurring/admin` — unauthenticated (fixed in RC2 P2)
- `PATCH /api/branches/[id]`, `PATCH /api/settings` — unauthenticated (fixed in RC2 P2)
- Payment audit Phase B table not migrated
- Text LINE keywords still auto-mark paid (ADR-008 transitional)

---

## Rollback

| Target | SHA / deployment |
|--------|------------------|
| **RC1** | `8c6ca04` / `dpl_iyt6jVxsEa7L2WLak1c7YAQWLUdY` |
| **Command** | Vercel Dashboard → Promote RC1 deployment |

Do **not** drop `payment_events` table on rollback.
