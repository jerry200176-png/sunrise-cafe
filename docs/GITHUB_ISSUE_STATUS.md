# GitHub Issue Status (living registry)

**Updated:** 2026-07-11  
**Note:** Cloud integration cannot post issue comments — status tracked here until Founder posts to GitHub.

| # | Title | Status | Owner | Acceptance / next |
|---|-------|--------|-------|-------------------|
| 53 | Payment Flow Optimization | **OPEN P1** | Product | Needs OUTCOME_LOG baseline; child: deposit conversion UX |
| 54 | Production Excellence epic | **OPEN** | Eng | Track via CAPABILITY_GAPS + orchestrator; defer phase drafts |
| 61 | AI workflow docs | **DONE** → close | Eng | Shipped `docs/workflows/README.md` — run hygiene to close |
| 63 | PaymentProvider abstraction | **DEFER P3** | Eng | Close when CAPABILITY_GAPS CG; no gateway contract |
| 95 | Founder Ops Batch | **OPEN P0** | Founder | GitHub ✅; remaining: Supabase migrations only |
| 99 | Integrated deposit capture | **OPEN strategic** | Product | After #53 KPI; Stripe/LINE Pay decision |

## Completed (reference)

| # | Closed | Evidence |
|---|--------|----------|
| 59 | 2026-07-11 | E2E `e2e/critical-flows.spec.ts` |
| 60 | 2026-07-11 | `ops-log.ts` + webhook.event_handled |
| 62 | 2026-07-11 | `/api/admin/payments/reconcile` |
