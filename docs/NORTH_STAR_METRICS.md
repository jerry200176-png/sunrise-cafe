# North Star Metrics

**Updated:** 2026-07-11  
**Live API:** `GET /api/admin/north-star` (requires `bi:read`)  
**Targets:** `src/lib/north-star-targets.ts` (rationale required)

> Every metric: **Observed · Target · Delta · Trend · Source · Last Updated**

## Registry

| ID | Metric | Observed | Target | Δ | Trend (7/30/90) | Source | Updated |
|----|--------|----------|-------:|--:|-----------------|--------|---------|
| `booking_conversion` | Form → booking | — | 65% | — | —/—/— | ops-log funnel | telemetry live |
| `deposit_conversion` | Deposit paid (30d) | pipeline | 85% | pipeline | —/30d/— | `deposit_rate_pct` | pipeline |
| `waitlist_conversion` | Waitlist → booked | pipeline | 30% | pipeline | —/30d/— | `conversion_pct` | pipeline |
| `avg_booking_time` | Median minutes | — | <5 min | — | —/—/— | ops-log timestamps | unmeasured |
| `payment_completion_rate` | Instructions → CTA | — | 70% | — | —/—/— | ops-log funnel | telemetry live |
| `admin_payment_review_sla` | Oldest review (h) | pipeline | <4 h | pipeline | 7d/—/— | `payment_review_oldest_hours` | pipeline |
| `admin_keyboard_adoption` | Keyboard approvals | — | 30% | — | —/—/— | ops-log interaction | telemetry live |
| `customer_support_proxy` | Reviews + at-risk | pipeline | <5 | pipeline | 7d/—/— | pending + at_risk | pipeline |
| `production_error_rate` | Cron failures (7d) | pipeline | <1% | pipeline | 7d/—/— | cron job runs | pipeline |
| `cancellation_rate` | Cancelled (30d) | pipeline | <15% | pipeline | —/30d/— | `cancellation_rate_30d` | pipeline |
| `core_web_vitals_lcp` | LCP p75 | — | <2.5s | — | —/—/— | RUM | unmeasured |
| `api_latency_p95` | Admin API p95 | — | <500ms | — | —/—/— | Vercel logs | unmeasured |

**Observed** = live from API when `bi:read` available. This table is documentation; API is SSOT.

## Target rationale (summary)

| Metric | Target | Why |
|--------|-------:|-----|
| Booking Conversion | 65% | Multi-step form benchmark 55–70% |
| Deposit Conversion | 85% | OUTCOME_LOG + slot waste policy |
| Waitlist Conversion | 30% | OUTCOME_LOG + LINE notify window |
| Payment Completion | 70% | High-intent viewers → CTA click |
| Review SLA | 4h | Same-day deposit confirm (code SLA) |
| Keyboard Adoption | 30% | Power-user keep threshold at T+14 |
| Support Proxy | 5 | ~5 items/shift capacity |
| Cron Error | 1% | SRE reliability standard |
| Cancellation | 15% | Hospitality benchmark |
| LCP | 2.5s | Google CWV "good" |
| API P95 | 500ms | Nielsen 1s perceived wait |

Full text: `src/lib/north-star-targets.ts`

## Trend methodology

| Window | Source |
|--------|--------|
| 7d | Point metrics from 7d pipeline fields or weekly snapshot |
| 30d | Rolling 30d outcome metrics |
| 90d | `WEEKLY_EXECUTIVE_REVIEW.md` archive (manual until history DB) |

Run `npm run executive:review` weekly to snapshot Observed values into review archive.

## Status badges

| Badge | Meaning |
|-------|---------|
| 🟢 on_track | Observed meets Target (±10% for rates) |
| 🟡 at_risk | Below target or telemetry just added |
| 🔴 unmeasured | No Observed data — add telemetry before optimizing |

## Ops-log events

See previous version — guest funnel + admin events unchanged.

## Reduction opportunities

| Area | Opportunity | Metrics |
|------|-------------|---------|
| ReservationList | Inline modals (ADM-002) | support proxy, task completion |
| Query page | Sticky payment CTA (CX-007) | payment_completion_rate |
| Dashboard | 7→1 API (ADM-005) | api_latency_p95 |
| Unused features | Remove if Compare fails T+30 | all |
