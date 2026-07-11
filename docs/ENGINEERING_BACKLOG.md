# Engineering Backlog (Continuous Product Improvement)

**Updated:** 2026-07-11  
**Mode:** ROI-ranked by real user value — re-sorted after each delivery.

## Value lens (every P0 must answer)

1. How many users affected?
2. Staff time saved?
3. Booking completion impact?
4. Cancel / support / error reduction?
5. Production risk reduction?
6. Measurable outcome?

## P0 — In Progress

| ID | Item | ROI rationale | Status |
|----|------|---------------|--------|
| ADM-001 | Admin waitlist management | Staff-only; smaller guest surface than deposit | **Next** |

## P1 — Guest / Conversion (measurable via `deposit_rate_pct`, ops-log funnel)

| ID | Item | Why |
|----|------|-----|
| CX-006 | Waitlist confirm page i18n | EN/JA waitlist flow completion |
| CX-007 | Payment CTA sticky bar on mobile query | Click-through on small screens |
| CX-008 | Booking form a11y audit (focus order, labels) | Permanent a11y lane |

## P2 — Staff Efficiency

| ID | Item | Why |
|----|------|-----|
| ADM-002 | ReservationList: replace alert/confirm/prompt | Daily ops, mobile broken |
| ADM-003 | Payment review keyboard nav | High-frequency daily task |
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
| CX-005 | PR #133 — deposit deadline UX + guest funnel telemetry | `deposit_rate_pct`, `auto_releases_7d`, ops-log |
| CX-001–004 | PRs #130–#131 | E2E + manual |
| ADM-004 | PR #132 | Staff clicks saved |
| GH-* | PRs #126–#129 | CI green |
