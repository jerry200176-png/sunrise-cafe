# CTO Executive Report — Sunrise Cafe

**Date:** 2026-07-10  
**Author:** Engineering Leadership (first-principles review)  
**Audience:** Founder, operators, investors  
**Status:** Strategic recommendation — not an implementation plan

---

## Situation

Sunrise Cafe is a **working operations system** for a Taiwan hospitality business: private-room booking, deposit collection via LINE, staff admin, light ordering, and automated reminders. It runs in production at `https://sunrise-cafe-six.vercel.app` and solves real daily problems for 昇昇咖啡（大安店）.

Over the past year, the codebase **grew faster than the business model clarified**. Engineering invested heavily in platform primitives (RBAC tables, analytics pipelines, experiment frameworks, enterprise architecture documents) while **runtime enforcement and operator UX lagged**. The system behaves like a **single-owner internal tool** wearing **enterprise SaaS clothing**.

This is not a failure of engineering quality — the booking core is sound. It is a **strategy drift** problem: the team optimized for a hypothetical 500-branch franchise platform before maximizing value for the business that exists today.

---

## First-Principles Question

**What company are we actually building?**

| Identity | Description | Evidence in codebase |
|----------|-------------|----------------------|
| **A. Operator system** | Software that runs 昇昇咖啡's own branches better | README, LINE setup, deposit workflow, 大安店 pricing |
| **B. Vertical SaaS** | Product sold to other Taiwan café/tea-house operators | Multi-branch schema, RBAC design — but **no billing, onboarding, or tenant isolation** |
| **C. Franchise platform** | OS for hundreds of franchised locations | Documented in Phase 6–8 — **no franchise customers, no partner API consumers** |

**Current reality: A with accidental B prep. C is aspirational fiction.**

Until leadership explicitly chooses A, B, or C, every architectural debate will produce the wrong answer.

---

## Recommendation (Executive Summary)

### Choose **Strategy A→B** (operator excellence first, optional vertical SaaS in 18–24 months)

1. **Next 12 months:** Be the best booking + deposit + LINE ops system for 昇昇咖啡 (1–10 owned branches).
2. **Month 12–24:** If metrics justify it, productize for 5–20 external operators (similar venues in Taiwan).
3. **Do not pursue Strategy C** (franchise platform) unless a signed franchise deal exists.

This is not a retreat — it is **focus**. Shopify did not start as enterprise commerce. Toast did not start with 100,000 locations.

---

## What to Keep

| Asset | Why |
|-------|-----|
| **Core booking engine** | Overlap constraint, slot logic, deposit deadlines — differentiated and tested |
| **LINE dual-channel** | Taiwan market fit; deposit request + group ops alerts are the product moat |
| **Next.js + Supabase + Vercel** | Right stack for a 1–5 person team; ops cost near zero |
| **`src/lib/` business logic + tests** | 158 unit tests on payments, booking, auth — real engineering asset |
| **Payment review workflow** | Matches how Taiwan SMBs actually collect deposits (screenshot + human review) |
| **Multi-branch data model** | Correct long-term, already paid for — but finish wiring it |
| **Documentation culture** | Valuable — but consolidate from 38 files to ~8 living documents |

---

## What to Rewrite

| Area | Why | Business impact |
|------|-----|-----------------|
| **Authorization enforcement** | RBAC designed, not deployed — `staff` can approve payments | Legal/ops liability when hiring |
| **Per-branch configuration** | `branches.closed_dates` exists but booking reads global settings | Wrong availability = lost revenue |
| **Admin experience** | 12 disconnected pages, no role-aware navigation | Staff training cost, errors |
| **Cron reliability** | Sequential loops, minimal failure alerting | Silent ops failures at 3+ branches |
| **Documentation accuracy** | Docs claim features are "shipped" when only schema exists | Wrong engineering priorities |

---

## What to Delete or Freeze

| Item | Rationale |
|------|-----------|
| **"Platform Transformation Program" phases** | Process overhead exceeded delivery; replace with 90-day outcome goals |
| **AI platform roadmap** | No customer demand, no data volume, brand risk — delete for 3 years |
| **Experiment/A-B framework** (unless actively used) | Over-engineered for a café; one operator does not need growth experiments infra |
| **business_actions / recommendations** (if unused in daily ops) | Build only if manager opens dashboard weekly |
| **38 architecture documents** | Consolidate to: Architecture, Runbook, RBAC, Migrations, ENV, Decisions |
| **Microservices evaluation** | No evidence supports split |
| **Partner API / webhooks** | No customers asking; postpone until Strategy B has paying tenants |

**Do not delete code immediately** — freeze new investment, deprecate if unused for 90 days.

---

## What to Postpone (≥18 months)

- SSO / enterprise identity
- SMS/email notification channels
- Demand forecasting / ML
- Read replicas and data warehouse
- Franchise self-service onboarding
- OpenAPI / developer platform
- Full WCAG AA compliance program (unless contract requires)

---

## What to Accelerate (Next 90 Days)

| Priority | Initiative | Business KPI |
|----------|-----------|--------------|
| 1 | **Decide A vs B** (founder decision) | Clear product roadmap |
| 2 | **Enforce RBAC on all admin routes** | Safe staff hiring |
| 3 | **Fix per-branch `closed_dates`** | Booking correctness |
| 4 | **Deposit + booking hardening** | Prevent forged bookings, double-book races |
| 5 | **Cron reliability + alerting** | Tomorrow's reminders always send |
| 6 | **Audit log on payment + reservation changes** | Dispute resolution |
| 7 | **Admin nav by role** | Reduce support confusion |
| 8 | **Consolidate docs + truth table** | Engineering velocity |

---

## Financial / Business Model Implications

### Today (Strategy A)

Software is a **cost center** that reduces:
- Staff time on phone bookings
- Missed deposit follow-ups
- Manual LINE copy-paste
- Double-booking errors

**ROI metric:** hours saved per week × staff cost + recovered deposit revenue.

### Future (Strategy B)

If externalized, plausible pricing for Taiwan tea-house/café booking:

| Tier | Price | Includes |
|------|-------|----------|
| Starter | NT$1,500/mo | 1 branch, booking + LINE, 2 staff accounts |
| Growth | NT$3,500/mo | 3 branches, payments review, basic reports |
| Pro | NT$6,000/mo | 10 branches, RBAC, priority support |

**Prerequisite for B:** enforced multi-tenant isolation, automated onboarding, migration CI, 99.5% booking uptime SLO.

**Do not price or sell before P0 security is complete** — one data breach ends the business.

---

## 3–5 Year Outlook

| Year | Strategy A (recommended base) | Strategy B (if validated) |
|------|------------------------------|---------------------------|
| **Y1** | 1–5 branches, <500 bookings/day, 3–8 staff users | Pilot 3 external venues |
| **Y2** | Best-in-class LINE booking for own chain | 15–30 paying operators |
| **Y3** | Optional ordering depth or simplify ordering | 50 operators, NT$1–2M ARR |
| **Y4–5** | Regional chain (10–20 owned locations) | Category leader in TW private-room booking niche |

**Strategy C (500-branch franchise platform) is not justified by market evidence.** Revisit only if a franchise LOI exists.

---

## Risk Register (Executive)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Strategy ambiguity | High | High | Founder decision in 30 days |
| RBAC not enforced | Certain | High | 90-day security sprint |
| Supabase free-tier pause | Medium | High | Pro plan + backup exports |
| LINE API policy change | Low | High | Abstract notification layer (not multi-channel yet) |
| Key-person dependency | High | High | Doc consolidation + bus factor plan |
| Over-engineering | High | Medium | Freeze platform program; outcome-based roadmap |
| Selling before ready (B) | Medium | Existential | Gate on security checklist |

---

## Decision Required from Leadership

**Within 30 days, choose one:**

- [ ] **A only** — Internal ops tool for 昇昇咖啡. Optimize for operator efficiency. No external sales.
- [ ] **A→B** — Internal first, productize in 18 months if KPIs support. *(CTO recommendation)*
- [ ] **B now** — Sell to external operators within 6 months. Requires accelerated security + onboarding investment.
- [ ] **C** — Franchise platform. Requires franchise partner commitment and 3× engineering investment.

**Without this decision, engineering will continue building the wrong company.**

---

## Success Definition (12 Months)

Not lines of code. Not architecture documents.

| Metric | Target (Strategy A) | Target (Strategy B add-on) |
|--------|---------------------|---------------------------|
| Booking completion rate | ≥ 70% of started bookings | Same across tenants |
| Deposit collection rate | ≥ 85% within deadline | — |
| Cron reminder success | ≥ 99% daily | Per-tenant |
| Admin security incidents | 0 privilege escalations | 0 cross-tenant leaks |
| Staff onboarding time | < 30 min with role | < 1 hour self-serve |
| Engineering deploy frequency | Weekly, low rollback | Weekly |
| Monthly ops hours on software | < 4 hours | < 2 hours per tenant |

---

## CTO Bottom Line

Sunrise Cafe has **product-market fit as an operator tool** in a specific Taiwan hospitality niche (private-room booking + LINE deposits). The engineering team built **platform infrastructure for a company that does not yet exist**.

**Stop building the platform. Start finishing the product.**

Keep the stack. Rewrite enforcement. Delete roadmap theater. Decide the business. Then scale.

---

*Detailed strategies: `docs/CTO_STRATEGY.md`*
