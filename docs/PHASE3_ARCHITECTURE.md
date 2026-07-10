# Phase 3 — Product Intelligence + Enterprise Readiness

**Date:** 2026-07-10  
**Goal:** Transform Sunrise Cafe from a booking system into a measurable, scalable business platform.

---

## Architecture Proposal

```
┌─────────────────────────────────────────────────────────────────┐
│                        Customer / Admin UI                       │
│  trackEvent() ──► POST /api/analytics (allowlist, no PII)       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                     analytics_events (Supabase)                  │
│  event_name | session_id (anon) | branch_id | properties (JSON)  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│              GET /api/admin/analytics/summary (admin)            │
│  Funnel · cancellation rate · waitlist conversion · peak hours   │
└─────────────────────────────────────────────────────────────────┘

LINE OAuth (hardened):
  GET /api/auth/line/authorize ──► LINE ──► callback
       signed state (HMAC)              sets httpOnly line_bind cookie
  POST /api/reservations reads cookie only (never client line_user_id)
```

### Design principles

| Principle | Implementation |
|-----------|----------------|
| Privacy | No phone, name, email in analytics; anonymous `session_id` only |
| Reliability | Server-side events for `booking_completed`, `cancelled`, etc. |
| Extensibility | Allowlisted events + JSON properties for future dashboards |
| Security | LINE `userId` only in signed httpOnly cookie |

---

## Business Impact

| Initiative | Metric enabled | Business value |
|------------|----------------|----------------|
| 3-1 Analytics | Conversion funnel, abandonment step | Optimize booking UX → more revenue |
| 3-1 Analytics | Waitlist CTA → join rate | Fill empty slots |
| 3-2 E2E | Regression prevention | Fewer production incidents |
| 3-3 LINE hardening | Fraudulent LINE binding blocked | Trust + correct notifications |
| 3-4 Admin ops | Today's cancellations, waitlist queue | Less manual checking |
| 3-5 Release | Predictable deploys | Faster safe iteration |

---

## Implementation Priority

| Order | ID | Rationale |
|-------|-----|-----------|
| 1 | 3-1 Analytics | Enables all future product decisions |
| 2 | 3-3 LINE OAuth | Active security risk |
| 3 | 3-2 E2E | Locks in Phase 2 auth/concurrency work |
| 4 | 3-4 Admin ops | Daily operator efficiency |
| 5 | 3-5 Release | Process maturity |

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Analytics table growth | Medium | Index on `created_at`; future retention policy |
| PII leak in properties | Low | Server-side allowlist + strip |
| LINE cookie breaks booking | Medium | Fallback: copy from prior reservation by phone |
| E2E flakiness | Medium | API mocks, no live Supabase in CI |
| Migration not applied | Medium | `schema_migrations` + release checklist |

---

## Execution Log

See CHANGELOG `[RC3-Phase3]` and individual commit messages per sub-phase.
