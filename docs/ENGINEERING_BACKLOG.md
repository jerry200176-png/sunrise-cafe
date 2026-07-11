# Engineering Backlog (Continuous Product Improvement)

**Updated:** 2026-07-11  
**Mode:** Agent-owned prioritization — re-ranked after each delivery.

## P0 — In Progress

| ID | Item | Horizon | ROI | Status |
|----|------|---------|-----|--------|
| ADM-001 | Admin waitlist management page | Staff UX | High | **Next** |

## P1 — Guest / Conversion

| ID | Item | Why |
|----|------|-----|
| CX-005 | Payment instructions UX on query page (#53) | Reduce deposit drop-off |
| CX-006 | Waitlist confirm page i18n | EN/JA waitlist flow |
| CX-007 | Waitlist form mobile polish | Hidden feature discovery |

## P2 — Staff Efficiency

| ID | Item | Why |
|----|------|-----|
| ADM-002 | ReservationList: replace alert/confirm/prompt | Daily ops friction |
| ADM-003 | Payment review keyboard nav | High-frequency daily task |
| ADM-005 | Dashboard trend: single API call (7→1) | Morning load latency |

## P3 — Reliability / Observability

| ID | Item | Why |
|----|------|-----|
| OPS-001 | Verify Production SHA parity | Founder deploy only |
| OPS-002 | Supabase pending migrations (#95) | Data integrity |
| OPS-003 | OUTCOME_LOG baseline (#53) | Product KPI measurement |

## P4 — Maintenance (ongoing)

- GitHub/CI health after each merge
- Doc drift via autonomous loop
- Dependabot review when PRs appear

## Completed (this session arc)

| ID | Evidence |
|----|----------|
| CX-001 | PR #130 — clickable steps, skeletons, weekendFlag |
| CX-002 | PR #130 — inline cancel, reschedule confirm, locale dates |
| CX-003 | PR #131 — i18n success + waitlist-success |
| CX-004 | PR #131 — CopyBookingCodeButton i18n |
| ADM-004 | PR #132 — edit modal「套用估算」button |
| GH-001 | PRs #126–#129 — loop handler, push graceful, doc sync |
