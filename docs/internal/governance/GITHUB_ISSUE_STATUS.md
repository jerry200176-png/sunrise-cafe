# GitHub Issue Status (living registry)

**Updated:** 2026-07-13  
**Note:** Cloud agent updates this file; GitHub is SSOT for open/closed state.

| # | Title | Status | Owner | Acceptance / next |
|---|-------|--------|-------|-------------------|
| 99 | Integrated deposit capture (Stripe/LINE Pay) | **OPEN strategic** | Product | After deposit KPI stable; depends on #53 outcomes — manual gateway vs native |

## Closed (reference — do not re-open without new evidence)

| # | Title | Closed | Evidence |
|---|-------|--------|----------|
| 53 | Payment Flow Optimization | 2026-07-12+ | Shipped review queue + flex cards; KPI in OUTCOME_LOG |
| 54 | Production Excellence epic | 2026-07-12+ | Orchestrator #177, QA #176, CI resilience #175 |
| 61 | AI workflow docs | 2026-07-11 | `docs/workflows/README.md` |
| 63 | PaymentProvider abstraction | 2026-07-11 | Deferred → track via #99 |
| 95 | Founder Ops Batch | 2026-07-12+ | Migrations ✅; OUTCOME_LOG measured; Gmail optional |

## Completed (reference)

| # | Closed | Evidence |
|---|--------|----------|
| 59 | 2026-07-11 | E2E `e2e/critical-flows.spec.ts` |
| 60 | 2026-07-11 | `ops-log.ts` + webhook.event_handled |
| 62 | 2026-07-11 | `/api/admin/payments/reconcile` |
