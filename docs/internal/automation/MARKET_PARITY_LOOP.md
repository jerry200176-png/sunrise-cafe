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
| 11 | Reservation list attendance badge | ReservationList `guest_confirmed_at` | **DONE** |
| 12 | Urgent deposit nudge ≤6h | `deposit_urgent_reminder_sent_at` + Flex | **DONE** |
| 13 | Waitlist phone CTA (no LINE) | admin waitlist `needs_call` + tel: | **DONE** |
| 14 | Deposit-deadline cadence (Hobby-safe) | 4× daily UTC 01/07/13/19 | **DONE** |
| 15 | Deposit Flex deep-link `?code=` | line-cards query URI | **DONE** |
| 16 | Gate「待確認出席」noise | near-visit / is_notified only | **DONE** |
| 17 | Guest query attendance chip | lookup + query i18n | **DONE** |
| 18 | Staff LINE on attendance confirm | group Flex | **DONE** |
| 19 | Dashboard「待確認出席」count | tomorrow board chip | **DONE** |
| 20 | Payment Flex deep-link `?code=` | buildPaymentFlex / approved | **DONE** |
| 21 | Waitlist mark staff called | `staff_called_at` + PATCH | **DONE** |
| 22 | Query attendance confirm CTA | near-visit signed URL | **DONE** |
| 23 | Staff LINE when waitlist needs call | no_line → group Flex once | **DONE** |

## Deploy notes

- Run `supabase/migration-guest-confirmed-at.sql` on production (code degrades until then).
- Run `supabase/migration-deposit-urgent-reminder-sent.sql` for second deposit nudge (code degrades until then).
- Run `supabase/migration-waitlist-staff-called-at.sql` for「標記已來電」(code degrades until then).
- Run `supabase/migration-waitlist-staff-alerted-at.sql` for one-shot staff call alerts (code degrades until then).
- After merge: redeploy so hourly deposit-deadline cron registers on Vercel.
- Stop list: LINE Pay native (#99), SMS OTP, Google Reserve.
