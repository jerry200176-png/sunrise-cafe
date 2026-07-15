# Capability Gaps — Evidence-Based Registry

**Owner:** Orchestrator · Planner role  
**Updated:** 2026-07-15 (Maturity A loop-1)  
**Rule:** Gaps require **verified repo or production evidence** — not feature-parity wishlists.  
**Full audit:** [`COMPETITIVE_AUDIT_2026-07-15.md`](./COMPETITIVE_AUDIT_2026-07-15.md)  
**Maturity SSOT:** [`COMMERCIAL_MATURITY_RUBRIC.md`](./COMMERCIAL_MATURITY_RUBRIC.md) · [`COMMERCIAL_MATURITY_A_EVIDENCE.md`](./COMMERCIAL_MATURITY_A_EVIDENCE.md)

> Compare against mature orgs (Stripe, Vercel, GitHub, Linear, Cloudflare) to **identify** gaps; adopt only when evidence supports ROI for 昇昇咖啡.

---

## Open gaps (ranked)

| Rank | ID | Gap | Mature reference | Verified evidence | Proposed action | Owner | Status |
|------|-----|-----|------------------|-------------------|-----------|------|--------|
| 1 | CG-008 | Catalog RLS anon write (branches/rooms/settings) | Supabase deny-by-default | `rls-policies.sql` formerly FOR ALL; `supabase-fetch` mutations used anon | Service-role writes + `migration-rls-catalog-read-only.sql` | Agent | **FIXING** 2026-07-15 (apply SQL on prod after deploy) |
| 2 | CG-006 | Rate limits fail-open | Stripe: always enforce limits | Upstash unset → middleware fail-open | Set Upstash on Vercel | Founder | **OPEN** |
| 3 | CG-002 | Outcome metrics unmeasured | Stripe: revenue dashboards with SLAs | NORTH_STAR many unmeasured/pipeline | Weekly `/admin/executive` + `cto:outcomes` | Founder | **OPEN** |
| 4 | CG-009 | Paid-deposit cancel/refund policy vs consumer protection | Eatsy tiered refund | Guest cancel blocks paid; i18n non-refundable copy | Founder policy → productize | Founder | **OPEN** |
| 5 | CG-010 | Integrated deposit capture not closed in prod | Inline/OpenTable card deposit | Stripe code present; ROADMAP「規劃中」 | Gate on KPI; then #99 go-live | Founder | **OPEN** |
| 6 | CG-003 | Optional multi-branch LINE migration | Per-tenant config | `migration-branches-line-group-id.sql` optional | Apply when multi-group needed | Ops | **OPEN** optional |
| 7 | CG-007 | E2E coverage narrow | Vercel: critical path E2E | Needs `E2E_ADMIN_PASSWORD` secret | Set GHA secret; expand booking flow E2E | Agent/Founder | **PARTIAL** |
| 8 | CG-001 | GitHub backlog hygiene | GitHub: <3 open feature PRs | Mostly closed 2026-07-15; re-check quarterly | Hygiene automation | Agent | **WATCH** |

---

## Closed gaps (recent)

| ID | Gap | Closed by | Evidence |
|----|-----|-----------|----------|
| CG-R01 | No governance gate | PR #102 | `cto:governance` exit 2 when unhealthy |
| CG-R02 | Guest phone in URL | PR #100 | POST `/api/my-bookings` |
| CG-R03 | Payment auto-approve on LINE text | PR #98 | All sources → `pending_review` |
| CG-R04 | Manual LINE duplicate reminders | PR #101 | `force:false` on send-line |
| CG-R05 | No autonomous task selection | iter-011 | `cto:orchestrator` + task catalog |
| CG-R06 | Cron success not structured-logged | iter-012 | `cron.completed` in `job-runs.ts` |

---

## Comparison dimensions (review each quarter)

| Dimension | Our state | Reference bar | Action if gap |
|-----------|-----------|---------------|---------------|
| Deploy safety | CI + E2E + health endpoint | Preview per PR ✅ | Keep |
| Secret hygiene | gitleaks in CI | No secrets in repo ✅ | Keep |
| Incident response | RUNBOOK + Sentry optional | Pager/on-call N/A for SMB | Defer |
| Payment reconciliation | Manual review + CSV MVP | Stripe auto-reconcile | #99 when KPI measured |
| Multi-tenant | Multi-branch LINE groups ✅ | Shopify multi-store | Adequate for scale |
| AI-assisted dev | Orchestrator v1 | Cursor/Copilot workflows | **This iteration** |

---

## Stop list (do not pursue without evidence)

- Next.js 16 upgrade (Dependabot #90/#91) — DL-012
- PaymentProvider abstraction (#63) — no gateway contract
- Phase 4–8 roadmap docs — frozen per ENGINEERING_GOVERNANCE
- Inngest/Temporal — Vercel cron sufficient today

---

*Planner role: pick rank-1 **agent-executable** gap when gate PASS; otherwise independent governance tasks.*
