# Engineering Backlog (Continuous Product Improvement)

**Updated:** 2026-07-11  
**Mode:** Agent-owned prioritization — re-ranked after each delivery.

## P0 — In Progress

| ID | Item | Horizon | ROI | Status |
|----|------|---------|-----|--------|
| CX-003 | i18n success + waitlist-success pages | Guest UX | High | **Next** |

## P1 — Next (Guest / Conversion)

| ID | Item | Why |
|----|------|-----|
| CX-003 | i18n success + waitlist-success pages | EN/JA guests land on Chinese-only confirmation |
| CX-004 | CopyBookingCodeButton i18n | Accessibility + locale consistency |
| CX-005 | Payment instructions UX on query page (deposit conversion #53) | Reduce drop-off after booking |
| CX-006 | Waitlist form mobile polish + duration clarity | Hidden feature discovery |

## P2 — Staff Efficiency

| ID | Item | Why |
|----|------|-----|
| ADM-001 | Admin waitlist management page | Staff blind to waitlist queue |
| ADM-002 | ReservationList: replace alert/confirm/prompt with inline UI | Daily ops friction, mobile broken |
| ADM-003 | Payment review keyboard nav (j/k/a, Enter to reject) | High-frequency daily task |
| ADM-004 | Edit modal: one-click apply estimated price | Manual copy every edit |
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
| CX-001 | PR — clickable step pills, room/slot skeletons, weekendFlag fix |
| CX-002 | PR — inline cancel confirm, reschedule scroll+confirm, locale dates |
| GH-001 | PRs #126–#129 — loop handler, push graceful, doc sync |
| GH-002 | Stale branches cleared, open PRs = 0 |
