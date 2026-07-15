# Market parity loop — agent backlog

**Created:** 2026-07-15  
**Compare vs:** inline / TableCheck cancel-protection / TW LINE OA 包廂訂位 / EZTABLE 訂金體驗

## Gap vs market (actionable)

| # | Market standard | Loop fix | Status |
|---|-----------------|----------|--------|
| 1 | Deposit deadline exact time | payment-message + Flex | **DONE** |
| 2 | Success countdown + receipt | /book/success | **DONE** |
| 3 | Waitlist notify only if delivered | waitlist.ts | **DONE** |
| 4 | Mobile wizard draft | sessionStorage | **DONE** |
| 5 | Payment review on query | payment_events | **DONE** |
| 6 | Waitlist expiry → next guest | confirm route | **DONE** |
| 7 | Guest Confirm attendance D-1 | Flex CTA + `/book/confirm-visit` + `guest_confirmed_at` | **DONE** |
| 8 | Policy before submit | booking-policy on book/success | **DONE** |
| 9 | `.ics` calendar | `/api/guest/calendar` | **DONE** |
| 10 | Admin tomorrow chips | dashboard unpaid / confirmed | **DONE** |

## Deploy notes

- Run `supabase/migration-guest-confirmed-at.sql` on production (code degrades until then).
- Stop list: LINE Pay native (#99), SMS OTP, Google Reserve.
