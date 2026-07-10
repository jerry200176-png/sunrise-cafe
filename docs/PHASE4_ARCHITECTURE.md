# Phase 4 — Scale, Revenue Optimization, Operational Excellence

**Date:** 2026-07-10  
**Goal:** Evolve Sunrise Cafe from a reliable booking system into a **business growth platform** for multi-branch operations.

---

## 1. Current Maturity Assessment

| Dimension | Phase 3 state | Gap for commercial scale |
|-----------|---------------|--------------------------|
| **Analytics** | Event funnel + summary API | No hour-based occupancy, RevPAR, or revenue dashboard |
| **Customer CRM** | Phone per reservation | No return-rate, segmentation, or lifecycle view |
| **Reservation intelligence** | Waitlist notify on cancel | No slot recommendations, demand forecast, recovery metrics |
| **Operations** | Crons for reminders/deposit | No no-show detection, limited automation audit |
| **Engineering** | Release checklist, E2E | No SLO/DR, no formal dependency/security cadence |
| **Data model** | Single `reservations` fact table | No `customers` table; KPIs derived at query time |

**Maturity level:** *Growth-ready* (Phase 3) → target *Commercial platform* (Phase 4).

---

## 2. Proposed Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Admin Insights UI                             │
│  /admin/insights — KPI cards, funnel, branch compare, peak/off-peak   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 GET /api/admin/bi/summary   analytics_events      reservations
 (KPI engine)               (funnel, abandonment)  (revenue, occupancy)
        │                       │                       │
        └───────────────────────┴───────────────────────┘
                                │
                    src/lib/business-kpis.ts (pure functions)

Customer lifecycle (admin-only, aggregated):
 GET /api/admin/customers/insights — return rate, segments (no PII export)

Reservation intelligence (customer-facing, trust-preserving):
 src/lib/slot-recommendations.ts — suggest alternate slots/days
 waitlist auto-promotion (existing notifyWaitlist on cancel)

Operations automation:
 deposit-deadline cron (existing) + no-show scan cron (advisory)
 docs/OPERATIONS_AUTOMATION.md — audit + runbook
```

### KPI definitions

| KPI | Formula | Data source |
|-----|---------|-------------|
| Booking conversion rate | `booking_completed / booking_started` | `analytics_events` |
| Occupancy rate | `Σ booked hours / Σ available room-hours` | `reservations` + branch hours |
| RevPAR (room-hour) | `revenue / available room-hours` | `reservations.total_price` |
| Cancellation rate | `cancelled / all bookings` | `reservations.status` |
| No-show rate | `past-start unfulfilled / expected arrivals` | `reservations` (confirmed/pending past grace) |
| Customer return rate | `phones with ≥2 bookings / unique phones` | `reservations.phone` (admin only) |
| Waitlist recovery | `waitlist booked / waitlist joined` | `waitlist.status` |

**Privacy:** Customer KPIs use phone only in admin APIs; no phone in analytics events; insights API returns aggregates only.

---

## 3. Business Value Estimation

| Initiative | Operator impact | Revenue impact |
|------------|-----------------|----------------|
| Daily revenue + occupancy dashboard | See underperforming branches/rooms same day | Target promotions on off-peak slots |
| Conversion funnel | Fix abandonment step | +5–15% bookings (industry UX benchmark) |
| Waitlist recovery metrics | Prove waitlist ROI | Fill cancelled slots faster |
| Return customer visibility | Identify loyal guests for LINE campaigns | Repeat visit lift |
| Slot recommendations | Reduce "no contiguous slot" exits | Higher conversion without dark patterns |
| No-show visibility | Staff can follow up or release slots | Recover 1–2 slots/week/branch |
| SLO + DR docs | Faster incident recovery | Reduced downtime revenue loss |

---

## 4. Implementation Roadmap

| Priority | ID | Scope | Risk |
|----------|-----|-------|------|
| P0 | 4-1 | `business-kpis.ts`, BI API, `/admin/insights` | Low — read-only aggregation |
| P1 | 4-2 | Customer insights API (aggregates) | Low — admin auth required |
| P1 | 4-3 | Slot recommendations on book page | Low — heuristic only |
| P2 | 4-4 | No-show scan cron (advisory), ops automation doc | Medium — avoid auto-penalizing guests |
| P2 | 4-5 | SLO, DR, security checklist, architecture doc | None — documentation |
| P3 | 4-6 | Technical debt review + prioritized backlog | Ongoing |

**Explicitly deferred (trust / complexity):**
- Overbooking strategy
- Dynamic peak pricing (needs business policy)
- Dedicated `customers` table migration (Phase 4 uses phone grouping)
- ML demand forecasting

---

## 5. Execution Log

See CHANGELOG `[RC4-Phase4]` and PR for incremental delivery.
