# Phase 5 — Data Quality + Growth Engine

**Date:** 2026-07-10  
**Goal:** Turn insights into measurable business improvements while preserving guest trust.

---

## 1. Data Architecture Proposal

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Source of Truth Layer                            │
│  reservations (+ cancellation metadata, updated_at)                      │
│  payment_events · waitlist · branches/rooms · analytics_events           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 data-quality.ts          experiments              demand_snapshots
 (checks + anomalies)     (A/B registry)           (hourly/daily aggregates)
        │                       │                       │
        ▼                       ▼                       ▼
 /admin/data-quality     analytics + client        revenue prep API
 /admin/ops              experiment assignment      (no dynamic pricing)
        │
        ▼
 morning-summary · daily-report · exception alerts
```

### New tables

| Table | Purpose |
|-------|---------|
| `experiments` | Growth experiment registry (name, audience, dates, status) |
| `demand_snapshots` | Occupancy/demand/cancel patterns for future pricing |

### Schema extensions

| Column(s) on `reservations` | Purpose |
|-----------------------------|---------|
| `updated_at` | Reliable cancellation timing + DQ |
| `cancelled_at`, `cancelled_by`, `cancellation_reason` | Cancellation analysis |

### Analytics extension

- Allowlisted properties: `experiment`, `variant` (no PII)

---

## 2. Business Impact Analysis

| Initiative | Decision enabled | Expected outcome |
|------------|------------------|------------------|
| Data quality checks | Trust KPIs before acting | Fewer bad ops decisions |
| Cancellation reasons | Fix product/ops root causes | Lower cancel rate |
| Experiment framework | Test landing/booking changes safely | Measurable conversion lift |
| Retention opportunities | Proactive LINE campaigns | Higher return rate |
| Demand snapshots | Future pricing/off-peak promos | Revenue per room-hour ↑ |
| Morning summary + alerts | Faster daily response | Less revenue leakage |

---

## 3. Privacy Considerations

| Data | Handling |
|------|----------|
| Phone / name | Admin APIs only; retention lists use masked phones |
| Experiments | Anonymous `session_id` + variant cookie; no PII in `experiment` props |
| Customer segments | Aggregates in API; no bulk export endpoint |
| Cancellation reasons | Enum/free text optional; guest-submitted only on self-cancel |
| Demand snapshots | Aggregated counts only; no guest identifiers |
| LINE campaigns | Opt-in via existing `line_user_id` binding; manual approval for broadcasts |

**Principle:** Collect minimum data needed to improve service; never sell or expose guest lists.

---

## 4. Implementation Roadmap

| Priority | ID | Deliverable |
|----------|-----|-------------|
| P0 | 5-1 | Migration (metadata), `data-quality.ts`, report API, `DATA_DICTIONARY.md` |
| P0 | 5-5 | `ops-exceptions.ts`, morning/daily report APIs, `/admin/ops` |
| P1 | 5-2 | `experiments` table, admin API, client assignment, analytics props |
| P1 | 5-4 | `demand_snapshots` + daily collect cron |
| P1 | 5-3 | `customer-retention.ts`, opportunities API |
| P2 | 5-5 | Morning LINE cron (optional, uses existing group infra) |

**Deferred:** Dynamic pricing, automated marketing blasts without review, dedicated `customers` table.

---

## 5. KPI → Action Loop

```
BI insights (Phase 4) → DQ validation (Phase 5) → Experiment (Phase 5)
        → Measure conversion → Retention campaign → Demand data for pricing prep
```

See `docs/DATA_DICTIONARY.md` for field definitions.
