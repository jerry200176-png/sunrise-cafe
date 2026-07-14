# AI-Readable Workflows

Machine- and human-readable booking system flows.  
**Issue:** #61 · **Owner:** Engineering

---

## Booking (guest)

```
/book → branch → date → room → slot → form → POST /api/bookings
  → /book/success?code=XXXXXX
  → /book/query?code=XXXXXX (auto-search if phone in sessionStorage)
```

| Step | API | Auth |
|------|-----|------|
| Availability | `GET /api/availability` | Public |
| Create | `POST /api/bookings` | Public |
| Query | `POST /api/my-bookings` | phone + booking_code **or** phone + booking_date (forgot-code) |
| Cancel | `POST /api/cancel-booking` | phone + booking_code |
| Reschedule | `POST /api/reschedule-booking` | phone + booking_code |

Forgot booking code: `/book/query` →「忘記訂位代號？」→ phone + reservation date (Taipei today…+90d) returns active bookings including `booking_code`.

## Payment (guest → staff)

```
Guest pays via LINE (image/text) → webhook /api/webhooks/line
  → payment_events (pending_review)
  → Staff /admin/payments → approve/reject
  → reservations.is_deposit_paid updated on approve
```

## Waitlist

```
/book/waitlist → notify on cancel → /book/waitlist/confirm?token=
  → POST /api/waitlist/confirm → booking created
```

## Admin

| Area | Path | RBAC |
|------|------|------|
| Reservations | `/admin` + `/api/reservations` | reservations:read/write |
| Payments | `/admin/payments` | payments:read/approve |
| Executive | `/admin/executive` | bi:read |

## Cron (Vercel)

| Job | Route | Schedule |
|-----|-------|----------|
| Tomorrow LINE | `/api/admin/reminders/send-line` | daily |
| Deposit deadline | `/api/admin/reminders/deposit-deadline` | daily |

---

*Update when routes change. SSOT: `IMPLEMENTATION_TRUTH.md`.*
