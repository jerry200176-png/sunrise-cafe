# AI-Readable Workflows

Machine- and human-readable booking system flows.  
**Issue:** #61 · **Owner:** Engineering

---

## Booking (guest)

```
/book → branch → date → room → slot → form → POST /api/bookings
  → /book/success?code=XXXXXX[&token=…]
  → /book/query?token=… (preferred one-tap; signed lookup token)
  → /book/query?code=XXXXXX (auto-search only if phone in sessionStorage)
```

LINE D-1 attendance confirm /「查看訂位詳情」use `/book/query?token=` (same signer as payment-approved Flex).  
Legacy `?code=` alone does **not** authenticate lookup without phone or token.

| Step | API | Auth |
|------|-----|------|
| Availability | `GET /api/availability` | Public |
| Create | `POST /api/bookings` | Public |
| Query | `POST /api/my-bookings` | **token** **or** phone + booking_code **or** phone + booking_date (forgot-code) |
| Cancel | `POST /api/cancel-booking` | token **or** phone + booking_code |
| Reschedule | `POST /api/reschedule-booking` | token **or** phone + booking_code |
| Confirm attendance | `GET/POST /api/guest/confirm-attendance` | attendance token; response includes `lookup_token` |

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
