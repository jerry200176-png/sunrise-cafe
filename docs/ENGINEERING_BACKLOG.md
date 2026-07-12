# Engineering Backlog (Continuous Product Improvement)

**Updated:** 2026-07-12  
**Mode:** ROI-ranked by real user value — re-sorted after each delivery.  
**Loop:** [`PRODUCT_IMPROVEMENT_LOOP.md`](./PRODUCT_IMPROVEMENT_LOOP.md) · [`HYPOTHESES.md`](./HYPOTHESES.md) · Metrics: [`NORTH_STAR_METRICS.md`](./NORTH_STAR_METRICS.md)

## Value lens (every P0 must answer)

1. How many users affected?
2. Staff time saved?
3. Booking completion impact?
4. Cancel / support / error reduction?
5. Production risk reduction?
6. Measurable outcome?

## P0 — Next

| ID | Item | ROI rationale | Status |
|----|------|---------------|--------|
| ADM-002 | ReservationList: replace alert/confirm/prompt | Daily ops friction; mobile confirm broken | **Done** (PR — toast + prompt dialog) |

## P1 — Measurement & Guest

| ID | Item | Why |
|----|------|-----|
| OPS-004 | North Star log aggregation (ops-log → ratios) | Enable booking_conversion & payment_completion_rate |
| CX-006 | Waitlist confirm page i18n | EN/JA waitlist flow completion |
| CX-006 | Waitlist confirm page i18n | EN/JA waitlist flow completion | **Done** (PR) |
| CX-007 | Payment CTA sticky bar on mobile query | `payment_completion_rate` | **Done** (merged #147) |
| CX-008 | Booking form a11y audit (focus order, labels) | Permanent a11y lane |

## P2 — Staff Efficiency

| ID | Item | Why |
|----|------|-----|
| ADM-005 | Dashboard trend: single API call (7→1) | Morning latency |

## P3 — Reliability / Observability

| ID | Item | Why |
|----|------|-----|
| OPS-001 | Verify Production SHA parity | Founder deploy only |
| OPS-002 | Supabase pending migrations (#95) | Data integrity |
| OPS-003 | OUTCOME_LOG auto-sync | `deposit_rate_pct` baseline for A/B |

## P4 — Permanent lanes (always on)

Performance · A11y · Mobile · Error/empty/loading · Monitoring · Security · CI/CD · DX

## Completed (session)

| ID | Evidence | Measured by |
|----|----------|-------------|
| OPS-004 | PR — North Star framework + booking funnel telemetry | `GET /api/admin/north-star`, ops-log events |
| ADM-001 | PR #135 — admin waitlist page + API | `waitlist_conversion_pct`, `admin.waitlist_expired` |
| ADM-003 | PR #134 — payment review keyboard nav + admin ops-log | `admin.payment_*` logs, `interaction` field |
| CX-005 | PR #133 — deposit deadline UX + guest funnel telemetry | `deposit_rate_pct`, `auto_releases_7d`, ops-log |
| CX-001–004 | PRs #130–#131 | E2E + manual |
| ADM-004 | PR #132 | Staff clicks saved |
| GH-* | PRs #126–#129 | CI green |
