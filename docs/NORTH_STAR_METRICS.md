# North Star Metrics

**Updated:** 2026-07-11  
**Live API:** `GET /api/admin/north-star` (requires `bi:read`)  
**Derived from:** `collectOutcomeMetrics()` + ops-log funnel events

> Rule: **Do not mark a feature complete until Compare is logged in [`IMPROVEMENT_LOG.md`](./IMPROVEMENT_LOG.md).**

## Metrics

| ID | Metric | Target | Direction | Primary source | Status |
|----|--------|-------:|-----------|----------------|--------|
| `booking_conversion` | Form entered → booking created | 65% | ↑ | ops-log `guest.booking_flow_entered` / `guest.booking_created` | 🟡 telemetry added |
| `deposit_conversion` | Eligible bookings with deposit paid (30d) | 85% | ↑ | `payment.deposit_rate_pct` | 🟡 pipeline |
| `waitlist_conversion` | Waitlist → booked (30d) | 30% | ↑ | `waitlist.conversion_pct` | 🟡 pipeline |
| `avg_booking_time` | Median minutes: flow enter → booking created | <5 min | ↓ | ops-log timestamps (future) | 🔴 unmeasured |
| `payment_completion_rate` | Deposit instructions viewed → pay CTA click | 70% | ↑ | ops-log funnel ratio | 🟡 telemetry added |
| `admin_payment_review_sla` | Oldest pending payment review (hours) | <4 h | ↓ | `payment.payment_review_oldest_hours` | 🟡 pipeline |
| `admin_keyboard_adoption` | Payment approvals via keyboard | 30% | ↑ | ops-log `interaction: keyboard` | 🟡 telemetry added |
| `customer_support_proxy` | Pending reviews + deposit at-risk | <5 | ↓ | `payment.pending_reviews` + `deposit_at_risk` | 🟡 pipeline |
| `production_error_rate` | Cron job failure rate (7d) | <1% | ↓ | `cron.jobs[].failed_7d / runs_7d` | 🟡 pipeline |
| `cancellation_rate` | Cancellations / all reservations (30d) | <15% | ↓ | `booking.cancellation_rate_30d` | 🟡 pipeline |
| `core_web_vitals_lcp` | Largest Contentful Paint (p75) | <2.5s | ↓ | RUM / Lighthouse CI | 🔴 unmeasured |
| `api_latency_p95` | Admin API p95 response time | <500ms | ↓ | Vercel logs / middleware | 🔴 unmeasured |

## How to read status

| Badge | Meaning |
|-------|---------|
| 🟢 on_track | Value meets target (or within 10% for rates) |
| 🟡 at_risk / telemetry | Measurable but below target, or telemetry just added |
| 🔴 unmeasured | No data path yet — add minimal telemetry before optimizing |

## Measurement cadence

| When | Action |
|------|--------|
| Before PR | Record baseline in `IMPROVEMENT_LOG.md` |
| After deploy + 7d | Compare Δ; update this table |
| Weekly | Sync health block to `OUTCOME_LOG.md` via `npm run cto:outcomes` |

## Ops-log funnel events (guest)

| Event | When |
|-------|------|
| `guest.booking_flow_entered` | `/book` page mount |
| `guest.booking_created` | `POST /api/reservations` success |
| `guest.booking_success_viewed` | `/book/success` with valid code |
| `guest.deposit_instructions_viewed` | Query page payment section |
| `guest.payment_line_pay_click` | LINE Pay CTA |
| `guest.payment_line_official_click` | LINE official account CTA |

## Ops-log admin events

| Event | When |
|-------|------|
| `admin.payment_approved` / `rejected` | Payment review; includes `interaction` |
| `admin.waitlist_expired` | Staff removes waitlist entry |

## Reduction opportunities (standing)

| Area | Opportunity | Metric impact |
|------|-------------|---------------|
| ReservationList | Replace `alert`/`confirm`/`prompt` → inline modals | `admin_task_completion_time`, mobile completion |
| Query page | Sticky payment CTA on mobile | `payment_completion_rate` |
| Dashboard | 7 API calls → 1 | `api_latency_p95` |
| Deposit flow | Deadline visible before LINE questions | `deposit_conversion`, support proxy |
