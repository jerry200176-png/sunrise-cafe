# RC2 P1 — Secure Reservation PATCH & Payment Audit Design

**Status:** Planning (not implemented)  
**Baseline:** RC1 `8c6ca04`  
**Constraints:** No production deploy until reviewed

---

## Problem statement

`PATCH /api/reservations/[id]` mutates sensitive fields (`is_deposit_paid`, `status`, pricing) but is **not** protected by admin session middleware. Any client that knows a reservation UUID can mark deposits paid or cancel bookings.

`ReservationList` (admin UI) calls this endpoint with the admin session cookie, but the API does not verify it.

---

## P1.1 — Secure `PATCH /api/reservations/[id]`

### Recommended approach: **middleware extension + shared auth helper**

Do **not** move the route to `/api/admin/...` in P1 (avoids breaking `ReservationList` URLs). Reuse the same session verification logic as `/api/admin/*`.

#### Step 1 — Extract shared guard

**New file:** `src/lib/admin-api-auth.ts`

```typescript
export async function requireAdminApiAuth(request: NextRequest): Promise<NextResponse | null>
```

- Returns `401 Unauthorized` JSON if `ADMIN_PASSWORD` is set and session invalid/missing
- Returns `null` if request may proceed (authorized or dev mode without password)
- Reuses `getSessionSecret()` + HMAC cookie verification (same as `middleware.ts` today)
- Does **not** accept `CRON_SECRET` (cron does not PATCH reservations)

#### Step 2 — Extend `middleware.ts`

Add block **before** admin page check:

```typescript
const isReservationMutation =
  /^\/api\/reservations\/[^/]+$/.test(pathname) &&
  (request.method === "PATCH" || request.method === "DELETE");

if (isReservationMutation) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;
}
```

**Also secure `DELETE`** on the same path (same handler file, same vulnerability).

**Do not** auth `POST /api/reservations` — guest booking (`book/page.tsx`) uses it.

#### Step 3 — Defense in depth (optional, same PR)

Call `requireAdminApiAuth` at top of `PATCH`/`DELETE` handlers in `route.ts`. Belt-and-suspenders if middleware matcher ever changes.

#### Preserved behavior

| Caller | After P1 |
|--------|----------|
| `ReservationList` PATCH (logged-in admin) | Works — sends `admin_session` cookie |
| Guest `POST /api/reservations` | Unchanged |
| Unauthenticated PATCH | **401** |
| Invalid/expired session | **401** |
| `ADMIN_PASSWORD` unset (local dev) | Unchanged fail-open |

No frontend changes required — admin pages already run on same origin with session cookie.

### Out of scope for P1.1 (document for P1.2)

These admin-only routes remain unauthenticated and should be secured in a follow-up commit:

| Route | Risk |
|-------|------|
| `GET /api/reservations?branchId=` | Lists all branch reservations |
| `POST /api/reservations/send-line` | Triggers LINE payment message |
| `POST /api/reservations/recurring/admin` | Creates recurring reservations |
| `POST /api/reservations` (admin form) | Same path as guest — needs separate admin route or header |

---

## P1.2 — Payment status audit logging (design only)

See `docs/PAYMENT_AUDIT_LOG.md` for full schema proposal.

**Phase A (no migration):** Extend `logPayment()` with `deposit_status.changed` events at all mutation sites.

**Phase B (RC2 P1 or P2):** Optional `payment_audit_log` table for queryable history.

---

## Affected files (implementation)

| File | Change |
|------|--------|
| `src/lib/admin-api-auth.ts` | **New** — shared guard |
| `src/lib/admin-api-auth.test.ts` | **New** — unit tests |
| `src/middleware.ts` | Add reservation PATCH/DELETE auth |
| `src/app/api/reservations/[id]/route.ts` | Optional in-handler guard |
| `src/lib/payment-log.ts` | Phase A audit actions (P1.2) |
| `src/app/api/reservations/[id]/route.ts` | Emit audit log on deposit patch |
| `src/app/api/webhooks/line/route.ts` | Emit audit log on auto-mark |
| `src/lib/payment-events-admin.ts` | Emit audit log on approve |
| `docs/PAYMENT_AUDIT_LOG.md` | **New** — schema design |
| `docs/DECISIONS.md` | ADR-009 (auth + audit) |

**Estimated diff:** ~200–350 lines (excluding tests/docs)

---

## Test strategy

### Unit tests — `admin-api-auth.test.ts`

| Case | Expected |
|------|----------|
| No `ADMIN_PASSWORD` | `null` (allow) |
| `ADMIN_PASSWORD` set, no cookie | `401` |
| Invalid cookie signature | `401` |
| Expired session | `401` |
| Valid signed session | `null` |

Use same HMAC signing as login route to build test cookies.

### Integration tests — `reservations-[id]-auth.test.ts`

Import `PATCH` handler; mock `updateReservationAdmin` + `isAdminConfigured`.

| Case | Expected |
|------|----------|
| PATCH `is_deposit_paid: true` without cookie | `401` |
| PATCH with valid admin cookie (via guard mock) | `200` + `updateReservationAdmin` called |
| PATCH payment fields with invalid cookie | `401`, no DB update |

Middleware-level tests: optional `middleware.test.ts` with mocked `NextRequest` if guard is only used via middleware — prefer testing guard directly.

### Regression

- Run existing 63 unit tests
- Manual: admin confirm booking + mark deposit paid in `/admin`
- Manual: guest booking still works

---

## Migration requirement

| Item | Migration? |
|------|------------|
| P1.1 PATCH auth | **No** |
| P1.2 Phase A (logs only) | **No** |
| P1.2 Phase B (`payment_audit_log` table) | **Yes** — separate migration file when approved |

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Admin UI breaks if cookie not sent | Low | High | Same-origin fetch; manual smoke test |
| Dev env without `ADMIN_PASSWORD` stays open | Known | Low | Document; production always has password |
| Only PATCH secured, GET still leaks | Medium | High | P1.2 follow-up in same RC2 sprint |
| Duplicate auth logic drift | Low | Medium | Single `requireAdminApiAuth` helper |

---

## Deployment sequence (when approved)

1. Merge RC2 P1.1 PR → CI green
2. Deploy to Vercel (no DB migration)
3. Verify: unauthenticated `curl -X PATCH` → 401
4. Verify: admin deposit mark still works
5. Monitor Vercel logs 24h

**Rollback:** Vercel promote RC1 `8c6ca04`
