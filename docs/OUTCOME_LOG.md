# Outcome Log — Business Evidence Only

**CTO OS v2 · Company-first**  
**Rule:** Health **outcome** scores read from this file (auto-synced by Outcome Pipeline).  
**Live SSOT:** [`/admin/executive`](https://sunrise-cafe-six.vercel.app/admin/executive) · `GET /api/admin/outcomes`

> **Automation:** `npm run cto:outcomes` fetches `/api/cto/outcomes` and updates the block below.  
> Manual SQL in `OPS_WEEKLY_BUSINESS_REVIEW.md` is **deprecated** — use dashboard for decisions.

---

## Latest measured outcomes

_Update weekly via [`OPS_WEEKLY_BUSINESS_REVIEW.md`](./OPS_WEEKLY_BUSINESS_REVIEW.md) § Outcome Review._

```outcome
date: null
deposit_rate_pct: null
waitlist_conversion_pct: null
payment_review_oldest_hours: null
migrations_all_applied: null
overlap_constraint_active: null
evidence_source: null
reviewer: null
```

**Status:** 🔴 **UNMEASURED** — no production evidence logged yet.  
Business-outcome health scores are **frozen at baseline** until first entry.

---

## Outcome history

| Week | 訂金率 | 候補轉換 | 審核最舊(h) | Migrations | Δ 訂金率 | 決策 |
|------|--------|----------|-------------|------------|----------|------|
| _pending_ | — | — | — | — | — | 首週 Review 後填入 |

---

## Entry template（每週複製）

```markdown
### YYYY-MM-DD — Week N Outcome Review

**Evidence:** Supabase SQL + /admin/payments screenshot or export  
**Reviewer:** Name

| Outcome metric | Value | Target | Δ vs last week |
|----------------|------:|-------:|---------------:|
| deposit_rate_pct | | 85% | |
| waitlist_conversion_pct | | 30% | |
| payment_review_oldest_hours | | <4 | |
| migrations_all_applied | yes/no | yes | |
| overlap_constraint_active | yes/no | yes | |

**What actually changed in the business:**
- 

**What did NOT improve (honest):**
- 

**Work to STOP (no ROI evidence):**
- 

**Work to CONTINUE:**
- 

**Update `outcome` block above with this week's values.**
```

---

*Capability ≠ Outcome. See `HEALTH_SCORES.md` § Capability vs Outcome.*
