# Hypotheses (Required Before Implementation)

Per [`PRODUCT_IMPROVEMENT_LOOP.md`](./PRODUCT_IMPROVEMENT_LOOP.md) §1. **No hypothesis → no code.**

## Active

### ADM-002 — ReservationList inline confirm modals

| Field | Value |
|-------|-------|
| **Problem** | `window.confirm` / `prompt` / `alert` fail or are unusable on mobile Safari; staff retry or skip actions (cancel, delete, deposit mark) |
| **Mechanism** | Inline modal (same pattern as edit dialog) works on all viewports; reduces failed taps and accidental dismiss |
| **North Star metrics** | `customer_support_proxy` (↓), implicit admin task completion |
| **Expected magnitude** | −2 support-proxy items/week; 0 failed cancel confirms on mobile (qualitative → ops-log later) |
| **Verify window** | T+7 after deploy |
| **If wrong** | If no mobile error reduction: remove modal layer, try bottom-sheet only; if still broken: merge actions into single tap with undo |

**Status:** 🚧 implementing (confirm slice) · hypothesis in [`HYPOTHESES.md`](./HYPOTHESES.md)

---

### CX-005 — Deposit deadline UX (#133)

| Field | Value |
|-------|-------|
| **Problem** | Guests don't know deposit deadline → auto-release → support LINE questions |
| **Mechanism** | Visible deadline + urgency styling + payment funnel telemetry |
| **North Star metrics** | `deposit_conversion` (+5pp), `payment_completion_rate` (+10pp), `customer_support_proxy` (−2) |
| **Verify window** | T+7 |
| **If wrong** | CX-007 sticky CTA; if still flat at T+30 → simplify to SMS reminder only |

**Status:** ⏳ pending production deploy · verdict pending

---

### ADM-003 — Payment keyboard nav (#134)

| Field | Value |
|-------|-------|
| **Problem** | Mouse-only review is slow for 10–30 daily items |
| **Mechanism** | j/k/Enter shortcuts reduce per-item time |
| **North Star metrics** | `admin_payment_review_sla` (−1h), `admin_keyboard_adoption` (≥30% at T+14) |
| **Verify window** | T+14 |
| **If wrong** | If adoption <10%: remove shortcuts, add batch approve; if SLA unchanged: rollback UI |

**Status:** ⏳ pending production deploy

---

### ADM-001 — Waitlist admin (#135)

| Field | Value |
|-------|-------|
| **Problem** | Staff cannot see waitlist queue → missed follow-ups |
| **Mechanism** | `/admin/waitlist` visibility + remove expired |
| **North Star metrics** | `waitlist_conversion` (+5pp), `customer_support_proxy` (−1) |
| **Verify window** | T+7 |
| **If wrong** | Add LINE notify SLA alert; if unused: merge into ReservationList tab and remove page |

**Status:** ⏳ pending production deploy

---

## Template

```markdown
### {ID} — {title}

| Field | Value |
|-------|-------|
| **Problem** | |
| **Mechanism** | |
| **North Star metrics** | |
| **Expected magnitude** | |
| **Verify window** | T+7 / T+14 / T+30 |
| **If wrong** | |

**Status:** hypothesis / implementing / pending deploy / confirmed / rejected
```

## Verdict log

| ID | Verdict | Date | Notes |
|----|---------|------|-------|
| _pending first production compares_ | | | |
