# Technical Debt Review — Phase 4

**Date:** 2026-07-10  
**Scope:** Post Phase 3/4 · prioritize meaningful impact only

## P1 — High impact

| Item | Issue | Recommendation |
|------|-------|----------------|
| No `customers` table | Return rate via phone grouping; no unified profile | Defer until CRM features need it; document in BI |
| `admin/page.tsx` monolith | ~960 lines, hard to maintain | Extract settings/branches into sub-routes when next touched |
| Overlap migration | `migration-reservations-no-overlap.sql` must be applied in prod | Verify with `scripts/verify-migrations.sh` |
| Reports vs BI overlap | Two report surfaces | BI is canonical for KPIs; reports for monthly export |

## P2 — Medium impact

| Item | Issue | Recommendation |
|------|-------|----------------|
| Recharts bundle | Loaded synchronously on reports/insights | `dynamic()` import when optimizing LCP |
| `npm audit` CI | `continue-on-error: true` | Fix or pin vulnerable deps quarterly |
| No-show status | Computed, not stored | Add `no_show` status only if ops need filtering |
| Peak pricing | Not implemented | Business policy first; avoid trust erosion |

## P3 — Low / defer

| Item | Notes |
|------|-------|
| ML demand forecasting | Insufficient data volume today |
| Overbooking | High trust risk for café use case |
| Dedicated staging DB | Documented in `STAGING.md`; manual for now |
| Analytics retention policy | Table small; revisit at 1M+ rows |

## Performance

- **BI API:** Single query per period; acceptable for <10k reservations/90d
- **Operations overview:** N+1 room fetch per branch — batch if branch count grows
- **Supabase free tier:** 7-day pause risk — uptime ping

## Duplication removed in Phase 4

- KPI logic centralized in `business-kpis.ts` (was scattered in reports + analytics)

## Next review

After multi-branch scale (>3 branches, >500 bookings/month) or Q4 2026.
