# Improvement Log — Baseline → Compare

Per [`PRODUCT_IMPROVEMENT_LOOP.md`](./PRODUCT_IMPROVEMENT_LOOP.md). Newest first.

---

## CX-005 — Deposit deadline UX (#133)

| Field | Value |
|-------|-------|
| **Metric** | `deposit_conversion`, `payment_completion_rate`, `customer_support_proxy` |
| **Baseline** | `deposit_rate_pct`: pipeline (pre-deploy unmeasured in prod); no deposit deadline UI; no payment funnel ops-log |
| **Expected** | ↑ deposit pay-before-deadline; ↑ payment CTA clicks; ↓ auto_releases_7d |
| **Measure via** | `payment.deposit_rate_pct`, `guest.deposit_*` ops-log, `cancellation.auto_release_proxy_7d` |
| **Deploy status** | ⏳ pending production (Vercel rate limit) |
| **After (T+7d)** | _pending_ |
| **Met target?** | _pending_ |
| **Iterate** | _pending — if no Δ, try CX-007 sticky CTA_ |

---

## ADM-003 — Payment keyboard nav (#134)

| Field | Value |
|-------|-------|
| **Metric** | `admin_payment_review_sla`, `admin_keyboard_adoption` |
| **Baseline** | All approvals via click; `payment_review_oldest_hours` from pipeline |
| **Expected** | ↓ review time per item; ≥30% keyboard adoption within 14d |
| **Measure via** | `admin.payment_*` ops-log `interaction` field; `payment_review_oldest_hours` |
| **Deploy status** | ⏳ pending production |
| **After (T+7d)** | _pending_ |
| **Met target?** | _pending_ |
| **Iterate** | _pending — if adoption <10%, add onboarding tooltip_ |

---

## ADM-001 — Waitlist admin (#135)

| Field | Value |
|-------|-------|
| **Metric** | `waitlist_conversion`, `customer_support_proxy` |
| **Baseline** | Staff blind to queue; `waitlist.conversion_pct` from pipeline |
| **Expected** | Staff can act on notified entries; conversion visibility → faster follow-up |
| **Measure via** | `waitlist.conversion_pct`, `admin.waitlist_expired` count |
| **Deploy status** | ⏳ pending production |
| **After (T+7d)** | _pending_ |
| **Met target?** | _pending_ |
| **Iterate** | _pending — if conversion flat, add notify→confirm SLA alert_ |

---

## ADM-002 — ReservationList inline confirm modals (slice 1)

| Field | Value |
|-------|-------|
| **Problem** | `window.confirm` broken on mobile Safari |
| **Mechanism** | `ConfirmDialog` component replaces 6 confirm flows |
| **North Star metrics** | `customer_support_proxy` |
| **Expected magnitude** | −2 support-proxy items/week |
| **Verify window** | T+7 |
| **If wrong** | Bottom-sheet only; merge actions with undo |

### Compare

| Field | Value |
|-------|-------|
| **Observed (baseline)** | 6+ `window.confirm` in ReservationList |
| **Observed (after)** | 0 confirm (slice 1); alert/prompt remain |
| **Deploy status** | ⏳ pending |
| **Met target?** | _pending T+7_ |

---

## Template (copy for next PR)

```markdown
## {ID} — {title} (#PR)

### Hypothesis (required before code — see HYPOTHESES.md)

| Field | Value |
|-------|-------|
| **Problem** | |
| **Mechanism** | |
| **North Star metrics** | |
| **Expected magnitude** | |
| **Verify window** | T+7 / T+14 / T+30 |
| **If wrong** | |

### Compare

| Field | Value |
|-------|-------|
| **Observed (baseline)** | |
| **Observed (after)** | |
| **Target** | |
| **Delta** | |
| **Met target?** | |
| **Iterate** | modify / simplify / merge / remove / rollback |
| **Deploy status** | |
```

## Process debt spotted

| Item | Type | Next action |
|------|------|-------------|
| ReservationList native dialogs | Reduce clicks / mobile errors | ADM-002 |
| Admin dashboard 7 fetches | Merge API | ADM-005 |
| ~~No booking funnel until 2026-07-11~~ | ~~Telemetry gap~~ | ✅ flow_entered / created / success_viewed |
| OUTCOME_LOG unmeasured | Weekly sync blocked | OPS-003 / Founder `CTO_OUTCOME_SECRET` |
| Ops-log ratios not aggregated | Measurement gap | OPS-004 follow-up: log drain → north-star API |

---

## OPS-004 — North Star framework (this PR)

| Field | Value |
|-------|-------|
| **Metric** | All North Star metrics (framework) |
| **Baseline** | 6 pipeline metrics measurable; 6 unmeasured; no improvement loop docs |
| **Expected** | Every future PR logs baseline/compare; funnel telemetry enables booking_conversion |
| **Measure via** | `GET /api/admin/north-star`, Executive dashboard section |
| **Deploy status** | ⏳ pending production |
| **After (T+7d)** | _pending_ |
| **Met target?** | _pending — success = measured_count increases as logs accumulate_ |
| **Iterate** | _pending — wire ops-log aggregation for funnel ratios_ |
