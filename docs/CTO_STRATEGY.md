# CTO Strategy — Sunrise Cafe (First Principles)

**Date:** 2026-07-10  
**Scope:** Technical strategy, product strategy, scaling roadmap, engineering organization, execution plan  
**Companion:** `docs/CTO_EXECUTIVE_REPORT.md`  
**Method:** Implementation verified against code on `main` @ `6b1d179`. Prior phases and roadmaps intentionally ignored.

---

## Table of Contents

1. [Technical Strategy](#1-technical-strategy)
2. [Product Strategy](#2-product-strategy)
3. [Scaling Roadmap](#3-scaling-roadmap)
4. [Engineering Organization Roadmap](#4-engineering-organization-roadmap)
5. [Prioritized Execution Plan](#5-prioritized-execution-plan)

---

# 1. Technical Strategy

## 1.1 Current State (Verified)

```
183 TypeScript files · 71 API routes · ~6,000 lines in src/lib/
Stack: Next.js 15 + Supabase PostgreSQL + Vercel + LINE (2 channels)
Tests: 158 unit (lib) · 1 API route · 11 E2E (mocked)
Crons: 7 Vercel scheduled jobs · job_runs used on 1 cron only
Auth: Binary admin session (broad) · RBAC on 6 route files (~14%)
```

**What works in production:**
- Guest booking wizard with overlap prevention (app + DB exclusion constraint)
- Deposit deadline automation with LINE reminders
- Payment screenshot review + keyword detection (dual path)
- Multi-branch LINE group digests via `branches.line_group_id`
- Waitlist on cancellation
- Admin dashboards (insights, ops, payments)

**What does not match documentation:**
- RBAC permissions exist in `rbac.ts` but are not enforced on payments, reservations, orders, menu
- `branches.closed_dates` column exists; availability reads `settings.closed_dates`
- `admin_audit_logs` table exists; `writeAdminAuditLog()` is never called
- `cron-batch.ts` exists; crons still loop sequentially
- Catalog mutations **are** admin-protected (RC2-P2) — older security docs are stale

## 1.2 Architectural Verdict

| Question | Answer |
|----------|--------|
| Is the monolith wrong? | **No.** Correct for 3–5 year horizon at expected scale. |
| Is Vercel wrong? | **No.** Serverless fits bursty booking traffic. Revisit only if crons exceed limits at 30+ branches. |
| Is Supabase wrong? | **No.** Best fit for small team + Postgres needs. Upgrade to Pro; add backups. |
| Is LINE wrong? | **No.** Core moat for Taiwan market. Abstract sending; do not add SMS yet. |
| Is Next.js App Router wrong? | **Partially.** Over-reliance on `"use client"` pages is a maintainability cost, not a scale blocker. Migrate admin data fetching incrementally, not big-bang RSC rewrite. |
| Should we adopt microservices? | **No.** No organizational or traffic evidence. |
| Should we adopt event bus / Temporal? | **Not yet.** PostgreSQL outbox is sufficient when async side effects become painful (cancel → waitlist → LINE failures). |
| Should we replace custom RBAC with Supabase Auth? | **Evaluate at Strategy B**, not before. Current tables work; enforcement is the gap, not the schema. |

## 1.3 Target Architecture (3–5 Years)

**Modular monolith** — one deployable unit, strict internal module boundaries.

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel (single deployment)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Guest Web   │  │ Admin Web    │  │ API + Cron Worker │  │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬─────────┘  │
│         └────────────────┼────────────────────┘              │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Platform Layer (thin)                                 │   │
│  │ auth · rbac · audit · rate-limit · feature-flags     │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                           ▼                                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│  │ Booking    │ │ Payment    │ │ Notify     │ │ Ops/BI   │ │
│  │ module     │ │ module     │ │ (LINE)     │ │ module   │ │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └────┬─────┘ │
│        └──────────────┴──────────────┴─────────────┘       │
│                          ▼                                   │
│              Supabase PostgreSQL (SoT)                       │
└─────────────────────────────────────────────────────────────┘
         LINE APIs                    print-bridge (optional, per-store)
```

**Explicitly NOT in 3–5 year target:** Kubernetes, Kafka, multi-region active-active, separate notification microservice.

## 1.4 Subsystem Decisions

| Subsystem | Decision | Rationale |
|-----------|----------|-----------|
| **Booking engine** | **Keep + harden** | Core IP; add server-side price validation, row-level locking on hot slots |
| **Payment / deposit** | **Keep + simplify** | Remove auto-keyword marking when screenshot review is primary (ADR-008 completion) |
| **LINE integration** | **Keep + abstract** | `sendNotification(template, channel, recipient)` wrapper; no second channel until B strategy |
| **Ordering + print-bridge** | **Freeze** | Scope creep risk; measure order volume 90 days; deprecate if <5% of sessions |
| **Analytics / BI** | **Simplify** | Keep 5 KPIs on dashboard; freeze experiments, demand_snapshots, data-quality cron unless ops uses weekly |
| **RBAC** | **Rewrite enforcement layer** | Keep schema; add `requirePermission` to every mutation route; add route tests |
| **Crons** | **Rewrite orchestration** | Fan-out per-branch `job_runs`; alert on failure; do not adopt Inngest until Vercel limits hit |
| **Migrations** | **Rewrite process** | Supabase CLI + staging auto-apply; never `schema.sql` on production |
| **Guest identity** | **Evolve to LINE-first** | Phone+code is fine for A; LINE binding becomes primary retention identity for B |
| **Admin UI** | **Rewrite navigation shell** | Shared layout, role-filtered nav, persistent branch context — not full redesign |
| **E2E tests** | **Rewrite strategy** | One real integration environment for booking + payment paths; keep mocked smoke for CI speed |
| **Documentation** | **Delete 70%** | 8 living docs + CHANGELOG; archive phase docs |

## 1.5 Security Strategy (Non-Negotiable)

**Before any external tenant (Strategy B) or staff hire beyond owner:**

1. 100% `requirePermission` on admin mutation routes
2. Server-side-only `status` and `total_price` on reservation create (verify RC2 fixes complete)
3. Mandatory Upstash rate limiting in production (fail-closed)
4. Audit log on: reservation status change, payment approve/reject, branch/room price change, user role change
5. Guest cancel/reschedule: booking_code required (already) + rate limit + optional LINE verification
6. Remove or gate `/api/diagnose`, fail-closed when `ADMIN_PASSWORD` unset in production

**Replace:** Shared `ADMIN_PASSWORD` with named admin users within 60 days.

## 1.6 Data Strategy

| Principle | Implementation |
|-----------|----------------|
| PostgreSQL is SoT | No secondary write databases |
| Branch is tenant key | Every reservation, order, event carries `branch_id`; queries filtered by RBAC scope |
| PII minimization | Analytics events stay PII-free; phone masked in retention APIs |
| Retention | Analytics 90 days; audit 2 years; reservations indefinite |
| Migrations additive only | Two-phase deploy for column removals |

**Replace:** Global `settings.closed_dates` reads with per-branch `branches.closed_dates` (migration already exists).

## 1.7 Observability Strategy

**Minimum viable observability (not Datadog enterprise):**

| Signal | Tool | Alert |
|--------|------|-------|
| Errors | Sentry (mandatory in prod) | New issue → LINE group |
| Cron success | `job_runs` table | Any `dead` status → LINE group |
| Booking 5xx | Sentry / Vercel | >1% in 15 min |
| Uptime | `/api/booking-health` + external ping | Downtime > 5 min |

**Delete:** SLO documents without automated measurement — replace with 3 alerts that actually fire.

## 1.8 Technical Debt Budget

Allocate **70% engineering time to reliability + correctness**, **20% to operator UX**, **10% to new capability** until Strategy decision and P0 security complete.

After P0: **50% product**, **30% reliability**, **20% growth (if B chosen)**.

---

# 2. Product Strategy

## 2.1 What Customers Actually Use

**Primary customer:** The café operator (not the guest, not the franchise CEO).

**Primary job-to-be-done:** Fill private rooms, collect deposits reliably, reduce LINE admin labor.

**Secondary:** In-venue ordering via QR (validate usage before investing).

### Guest journey (keep investing)

| Step | Value | Current quality |
|------|-------|-----------------|
| Discover availability | High | A- |
| Book + see price | High | A- |
| Pay deposit via LINE | High | A (Taiwan-specific moat) |
| Reminders | High | A |
| Cancel/reschedule | Medium | B |
| Waitlist when full | High | B+ (under-promoted in UI) |
| LINE bind | High | B |

### Operator journey (needs investment)

| Step | Value | Current quality |
|------|-------|-----------------|
| See today's bookings | High | B+ |
| Confirm deposit paid | High | B |
| Send manual LINE | Medium | B |
| Manage rooms/prices | High | C+ (global settings bug) |
| Multi-branch oversight | Medium | C (no role-aware UX) |
| Reports / insights | Low–Medium | C+ (pretty but unused?) |
| Staff accounts | High | D (RBAC not enforced) |

**Product insight:** Guests are well served. **Operators are the bottleneck for scale** — not architecture diagrams.

## 2.2 Competitive Position (Taiwan)

| Alternative | Strength | Sunrise advantage |
|-------------|----------|-------------------|
| Phone + LINE manual | Zero cost | Automation, no double-book |
| Google Forms + spreadsheet | Simple | Availability logic, deposit tracking |
| OpenTable / international SaaS | Brand | Wrong market; no LINE deposit workflow |
| iCHEF / POS systems | F&B POS | Room booking is niche; integrate later, don't rebuild POS |
| Custom dev per store | Tailored | Already built; operational knowledge |

**Moat:** LINE-native deposit workflow + private-room slot logic + Taiwan holiday/timezone correctness. **Not** generic analytics or AI.

## 2.3 Product Principles (Next 3 Years)

1. **Booking correctness > feature count** — A double-book destroys trust faster than a missing chart.
2. **LINE is the product** — Every roadmap item must strengthen LINE ops, not dilute it.
3. **Operator minutes saved** — Measure features by staff time reduction.
4. **No feature without weekly usage hypothesis** — If no one will open it weekly, don't build it.
5. **Guest PII is liability** — Minimize storage, maximize booking_code + LINE user ID.

## 2.4 Feature Portfolio Decision

| Feature | Verdict | Reason |
|---------|---------|--------|
| Booking + deposit + reminders | **Accelerate** | Core revenue |
| Payment screenshot review | **Keep** | Matches TW SMB behavior |
| Waitlist | **Accelerate** | Promote in UI when room full; fix LINE failure handling |
| Multi-branch admin | **Accelerate** | Needed for own chain growth |
| RBAC + staff accounts | **Accelerate** | Hiring blocker |
| Insights / BI dashboard | **Simplify** | 5 KPIs, not 20 charts |
| Experiments / A-B | **Delete** | No growth team |
| Demand snapshots | **Postpone** | No action taken from data |
| business_actions / AI recommendations | **Postpone** | No daily usage evidence |
| Recurring reservations | **Keep as-is** | Low maintenance if rarely used |
| QR ordering + print-bridge | **Freeze** | Validate demand; high ops burden (per-store Node) |
| i18n (full) | **Postpone** | Unless >10% non-Chinese guests |
| Dynamic pricing | **Postpone** | Operator can change room prices manually |
| Customer retention campaigns | **Postpone until B** | Marketing feature, not ops feature |

## 2.5 Strategy A Product Roadmap (Recommended Y1)

**Theme: "Trustworthy ops for every branch"**

| Quarter | Outcome |
|---------|---------|
| Q1 | Staff can log in with roles; no privilege leaks; per-branch closed dates work |
| Q2 | Unified admin shell; branch context persists; waitlist promoted in booking |
| Q3 | Deposit collection rate ≥85%; cron failures alert to LINE group |
| Q4 | 3-branch ops proven; decision gate for Strategy B |

## 2.6 Strategy B Product Roadmap (If Validated Y2)

**Theme: "LINE booking SaaS for Taiwan private-room venues"**

| Quarter | Outcome |
|---------|---------|
| Q1 B | Tenant onboarding wizard (branch + LINE + rooms); billing (manual invoice OK) |
| Q2 B | Self-serve staff invites; per-tenant branding (logo, colors) |
| Q3 B | 10 paying venues; case study; 99.5% booking SLO |
| Q4 B | POS integration partner (read-only reservation sync) — one integration only |

**Do not build:** Marketplace, app store, franchise portal, AI concierge.

## 2.7 Product Metrics That Matter

| Metric | Why | Ignore |
|--------|-----|--------|
| Deposit collection rate | Direct revenue | Page views |
| Booking completion rate | Conversion | Experiment variant counts |
| Cancellation/no-show rate | Ops planning | Analytics event volume |
| Waitlist conversion | Demand recovery | demand_snapshots rows |
| Staff actions per booking | Automation ROI | Lines of code |
| Time to onboard new branch | Scale readiness | Architecture maturity grades |
| Support tickets per week | Product quality | Number of admin pages |

---

# 3. Scaling Roadmap

Scaling is **branch count and staff users**, not requests per second. 10,000 reservations/day on this stack is a database indexing problem, not a microservices problem.

## 3.1 Scale Tiers

| Tier | Branches | Bookings/day | Staff users | Architecture response |
|------|----------|--------------|-------------|----------------------|
| **T0** (today) | 1–3 | <100 | 1–3 | Current stack OK with P0 fixes |
| **T1** | 3–10 | 100–300 | 5–15 | RBAC enforced, per-branch config, cron fan-out |
| **T2** | 10–30 | 300–1,000 | 15–50 | KPI materialization, job queue, staging CI |
| **T3** | 30–100 | 1,000–3,000 | 50–150 | Read replica for BI, Inngest for crons, tenant billing |
| **T4** | 100+ | 3,000+ | 150+ | Re-evaluate — only if Strategy B/C succeeds |

**CTO prediction:** 昇昇咖啡 realistically reaches **T1–T2** in 5 years. Plan for T2. Do not pre-build T4.

## 3.2 Scaling by Dimension

### Booking correctness (never compromise)

| Scale risk | Mitigation | When |
|------------|------------|------|
| Double-book race | `SELECT FOR UPDATE` on room slot or serializable transaction | T0 (now) |
| Wrong pricing (UTC day) | Taipei timezone everywhere | T0 |
| Wrong closed dates | Wire `branches.closed_dates` | T0 |
| Client-forged price/status | Server-only computation | T0 (verify) |

### Cron / background work

| Scale risk | Mitigation | When |
|------------|------------|------|
| Vercel 60s timeout | Per-branch `job_runs` fan-out | T1 |
| Silent cron failure | Alert to LINE ops group | T1 |
| Overlapping cron runs | Idempotent job keys | T1 |
| 100+ branch reminders | Inngest or dedicated worker | T3 |

### Database

| Scale risk | Mitigation | When |
|------------|------------|------|
| Slow BI queries | `kpi_daily` materialized table | T2 |
| Reservation list latency | `branch_id` index + pagination | T1 |
| Connection limits | Supabase pooler + Pro plan | T2 |
| Analytics table bloat | Retention cron (exists) | T0 |

### Admin UX

| Scale risk | Mitigation | When |
|------------|------------|------|
| Branch switching fatigue | Persistent branch context cookie | T1 |
| Wrong-branch edits | Branch scope in UI + API | T1 |
| Dashboard load (7 API calls) | Single aggregated endpoint | T2 |

### Multi-tenant (Strategy B only)

| Scale risk | Mitigation | When |
|------------|------------|------|
| Cross-tenant data leak | RLS + RBAC + integration tests | Before first external tenant |
| Tenant onboarding | Scripted setup + checklist | B Q1 |
| Per-tenant LINE channels | Already supported via `line_group_id` | T1 |

## 3.3 What NOT to Scale Prematurely

- Microservices
- Multi-region deployment
- Event sourcing
- CQRS
- Kubernetes
- Real-time analytics pipeline
- AI inference infrastructure

## 3.4 Capacity Headroom (Conservative)

Current architecture with P0 fixes and T1 mitigations:

| Resource | Comfortable limit | Hard limit |
|----------|--------------------|-----------|
| Branches | 30 | 100 (with T3 changes) |
| Reservations/day | 2,000 | 10,000 |
| Concurrent booking POSTs | 50 | 200 (with connection pool) |
| LINE pushes/hour | 500 | 2,000 (rate limit risk) |
| Admin concurrent users | 30 | 100 |

---

# 4. Engineering Organization Roadmap

## 4.1 Current Reality

Evidence suggests **1–2 builders** (possibly founder + AI-assisted development), not a 20-person platform team. The Phase 6–8 documents assumed an enterprise engineering organization that does not exist.

**Organizational debt:** Process designed for Shopify; team sized for a coffee shop software project.

## 4.2 Appropriate Org Model by Strategy

### Strategy A (1–5 engineers, years 1–2)

```
Founder/Operator
    └── Full-stack Engineer (product + infra)
         └── Part-time: Design/UX (contract)
         └── Part-time: QA (founder + checklists)
```

**No dedicated SRE, security, or platform teams.** Everyone owns reliability.

### Strategy B (5–12 engineers, years 2–4)

```
CTO / Tech Lead
├── Product Engineering (2–3) — guest + admin UX
├── Platform / Infra (1–2) — auth, crons, migrations, observability
├── Customer Success / Ops (1) — tenant onboarding, support
└── Founder / PM (1) — roadmap, pricing, partnerships
```

Hire **platform engineer only after 10 paying tenants** — not before.

### Strategy C (not recommended)

Would require 15–25 engineers, VP Engineering, separate SRE — **unjustified without franchise revenue.**

## 4.3 Roles: Hire vs Outsource vs Automate

| Function | Y1 | Y2 (if B) | Never hire full-time |
|----------|-----|-----------|---------------------|
| Full-stack product eng | Hire 1 | Hire 2nd | — |
| Security review | Annual pentest (outsource) | Quarterly | FTE security engineer |
| SRE | Automate alerts | 0.5 FTE infra | 24/7 NOC |
| UX design | Contract | Part-time | Large design team |
| QA | Founder + CI + 1 integration env | Hire QA part-time | 10-person QA org |
| DevOps | Vercel + Supabase managed | Same | Kubernetes admin |
| Data / ML | — | — | Data scientist (no data volume) |
| Technical writing | Engineer writes 8 docs | Same | 38-doc program |

## 4.4 Engineering Process (Simplified)

**Delete:**
- Phase-numbered architecture programs
- 11-role review board for every PR
- Enterprise maturity grading

**Keep:**
- Small PRs (< 500 lines preferred)
- CI: lint + test + build + migration manifest
- CHANGELOG on release
- ADR for decisions that are hard to reverse

**Add:**
- `IMPLEMENTATION_TRUTH.md` — single page: what is enforced vs schema-only
- Weekly 30-min ops review: cron logs, Sentry, deposit rate
- Monthly founder review: one product metric, one reliability metric
- Pre-mortem before Strategy B first tenant

## 4.5 Bus Factor Plan

| Risk | Mitigation |
|------|------------|
| Single engineer | 8 consolidated docs; env var runbook; recorded deploy video |
| LINE token rotation | Documented in RUNBOOK; test quarterly |
| Supabase access | 2 admin accounts; backup exports weekly |
| Vercel access | 2 team members |

## 4.6 Build vs Buy

| Need | Build | Buy / Use |
|------|-------|-----------|
| Booking | ✅ Core IP | — |
| Auth (B) | RBAC already started | Consider Clerk at 50+ tenants |
| Email | — | Resend (already in package.json) — use for admin invites only |
| SMS | — | Postpone |
| Billing (B) | — | Stripe Billing or manual invoice until 20 tenants |
| Monitoring | Sentry | Vercel Analytics (free tier) |
| Cron (T3) | job_runs first | Inngest |
| Print | print-bridge | Sunmi / vendor cloud if ordering scales |

---

# 5. Prioritized Execution Plan

Prioritized by **business impact**, not engineering elegance.

## 5.1 Decision Gate (Week 1–4)

| # | Action | Owner | Output |
|---|--------|-------|--------|
| D1 | Founder chooses Strategy A, A→B, B, or C | Founder | Signed 1-page strategy |
| D2 | Measure ordering usage (orders/week vs bookings/week) | Ops | Keep or freeze ordering |
| D3 | Measure insights usage (admin/insights visits/month) | Ops | Simplify or keep BI |
| D4 | Audit who has admin password today | Founder | User bootstrap list |

**Nothing else starts until D1 is complete.**

## 5.2 Wave 1 — Trust (Weeks 1–8) · BLOCKING

*No new features. Fix what breaks trust.*

| ID | Work | Business impact | Effort | Rollback |
|----|------|-----------------|--------|----------|
| W1-1 | `requirePermission` on all admin mutation routes | Safe hiring | M | Revert per route |
| W1-2 | Payment routes: `payments:read/approve` only | Prevent staff fraud | S | Revert |
| W1-3 | Reservation PATCH: role-based field allowlist | Ops integrity | S | Revert |
| W1-4 | Wire `branches.closed_dates` into availability + admin UI | Correct bookings | S | Feature flag |
| W1-5 | Server-side only `total_price` + `status` on create | Prevent fraud | S | Revert |
| W1-6 | Double-book race: transaction lock | Core correctness | M | Revert |
| W1-7 | `writeAdminAuditLog` on payment + reservation + price mutations | Disputes | S | Stop calling |
| W1-8 | Bootstrap admin users; rotate shared password | Accountability | S | Legacy login |
| W1-9 | Mandatory Upstash in production | Abuse prevention | S | Env toggle |
| W1-10 | Permission matrix tests (one file per domain) | Regression safety | M | — |

**Wave 1 success criteria:**
- Security engineer test: `staff` cannot approve payment → 403
- QA: two simultaneous bookings same slot → one succeeds
- Ops: branch A closed date does not show slots

## 5.3 Wave 2 — Reliability (Weeks 6–12)

| ID | Work | Business impact | Effort |
|----|------|-----------------|--------|
| W2-1 | Cron fan-out: per-branch `job_runs` for reminders | 3+ branches reliable | M |
| W2-2 | Cron failure alert → LINE ops group | Catch silent failures | S |
| W2-3 | Waitlist: do not mark notified if LINE fails | Recover demand | S |
| W2-4 | Promote waitlist CTA when room full on `/book` | Revenue recovery | S |
| W2-5 | Sentry mandatory + alert rules | Debuggability | S |
| W2-6 | Consolidate docs to 8 files; archive phase docs | Velocity | S |
| W2-7 | `IMPLEMENTATION_TRUTH.md` | Agent + engineer accuracy | S |

## 5.4 Wave 3 — Operator UX (Weeks 10–16)

| ID | Work | Business impact | Effort |
|----|------|-----------------|--------|
| W3-1 | Admin shared layout + sidebar | Training time | M |
| W3-2 | Nav filtered by `/api/admin/me` permissions | Fewer 403 surprises | S |
| W3-3 | Email + password on login page | RBAC usable | S |
| W3-4 | Persistent branch context across admin | Multi-branch ops | S |
| W3-5 | Dashboard: single aggregated API call | Mobile admin speed | M |
| W3-6 | Simplify insights to 5 KPIs | Reduce noise | S |

## 5.5 Wave 4 — Scale Prep (Weeks 14–24) · Only if A→B or 5+ branches planned

| ID | Work | Business impact | Effort |
|----|------|-----------------|--------|
| W4-1 | Staging environment + migration auto-apply | Safe deploys | M |
| W4-2 | `kpi_daily` materialization | BI speed at 10+ branches | M |
| W4-3 | PostgreSQL outbox for cancel → waitlist → LINE | Side effect reliability | L |
| W4-4 | Tenant onboarding script (branch + rooms + LINE) | Strategy B readiness | M |
| W4-5 | One real integration test environment | CI confidence | M |

## 5.6 Explicitly Deprioritized (Do Not Start in 2026)

- AI features
- Partner API
- Experiments framework (new work)
- SMS/email notifications
- Microservices evaluation
- OpenAPI generation
- Full i18n
- Dynamic pricing engine
- Demand forecasting
- Franchise self-service portal
- WCAG AA audit program
- New admin pages

## 5.7 PR Sizing Rules (Unchanged, Enforced)

| Size | Max lines | Rule |
|------|-----------|------|
| S | 300 | One route group or one bug |
| M | 800 | One wave item |
| L | 1500 | Must split unless approved by founder |

Every PR: tests + rollback note in description.

## 5.8 90-Day Scorecard

| Dimension | Today | 90-day target | Justified? |
|-----------|------:|--------------:|------------|
| Engineering | 72 | 82 | Yes |
| Product | 78 | 85 | Yes |
| Security | 68 | 88 | Yes — blocking |
| Reliability | 74 | 86 | Yes |
| Scalability | 70 | 78 | Yes (T1 prep) |
| Maintainability | 76 | 84 | Yes (doc consolidation) |
| Business value | 80 | 88 | Yes (deposit rate, ops hours) |

**Stop criterion:** If Strategy A only and <3 branches, Wave 4 items W4-2 through W4-4 are **not justified** — stop at Wave 3.

## 5.9 Investment Summary

| Wave | Calendar | Engineering cost | Expected ROI |
|------|----------|------------------|--------------|
| Decision | Weeks 1–4 | Founder time | Prevents wrong builds |
| Wave 1 Trust | Weeks 1–8 | ~1 engineer × 6 weeks | Enables hiring; prevents fraud |
| Wave 2 Reliability | Weeks 6–12 | ~1 engineer × 4 weeks | Prevents silent revenue loss |
| Wave 3 Operator UX | Weeks 10–16 | ~1 engineer × 4 weeks | −50% staff training time |
| Wave 4 Scale prep | Weeks 14–24 | ~1 engineer × 6 weeks | Only if B or 5+ branches |

**Total: ~4–6 engineer-months** — vs 12+ months of Phase 4–8 documentation and partial platform primitives with incomplete enforcement.

---

## Appendix A: Documentation Consolidation Plan

**Keep (living):**
1. `CLAUDE.md` — operator handbook
2. `docs/ARCHITECTURE.md` — system overview
3. `docs/RUNBOOK.md` — incidents
4. `docs/RBAC.md` — permissions (update after Wave 1)
5. `docs/MIGRATIONS.md` — schema changes
6. `docs/ENV.md` — configuration
7. `docs/DECISIONS.md` — ADRs
8. `docs/IMPLEMENTATION_TRUTH.md` — **new** enforced vs schema-only

**Archive to `docs/archive/`:**
- PHASE4–8 architecture docs
- Enterprise target architecture
- Platform governance program docs
- Security maturity phase docs (after merging open items into RUNBOOK)

## Appendix B: Subsystem Replacement Triggers

| Subsystem | Replace when | With what |
|-----------|--------------|-------------|
| Vercel crons | Job timeout at 30+ branches | Inngest |
| Custom RBAC | 50+ tenants, SSO required | Supabase Auth + RLS |
| print-bridge | 10+ stores with ordering | Vendor cloud print |
| Phone guest auth | LINE bind rate > 60% | LINE-primary identity |
| Manual billing | 20+ paying tenants | Stripe Billing |

## Appendix C: Challenge Log (Assumptions Rejected)

| Assumption | Verdict | Reason |
|------------|---------|--------|
| "We are a 500-branch platform" | **Rejected** | No business evidence |
| "We need microservices" | **Rejected** | Traffic and team size don't support |
| "We need an event bus now" | **Rejected** | Inline flows work; outbox later if needed |
| "We need AI ops" | **Rejected** | No data volume, brand risk |
| "Experiments drive growth" | **Rejected** | No growth team, café SMB |
| "More docs = more maturity" | **Rejected** | Docs contradicted code; created false confidence |
| "RBAC tables = RBAC shipped" | **Rejected** | 14% route coverage |
| "Ordering is core product" | **Unverified** | Measure before investing |
| "Next.js monolith won't scale" | **Rejected** | Scales to T2 easily |
| "Supabase is a prototype DB" | **Rejected** | Production-grade with Pro plan |

---

*This document supersedes Phase 4–8 roadmaps for planning purposes. Implementation source of truth remains the codebase.*
