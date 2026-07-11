# Capability Gaps — Evidence-Based Registry

**Owner:** Orchestrator · Planner role  
**Updated:** 2026-07-11  
**Rule:** Gaps require **verified repo or production evidence** — not feature-parity wishlists.

> Compare against mature orgs (Stripe, Vercel, GitHub, Linear, Cloudflare) to **identify** gaps; adopt only when evidence supports ROI for 昇昇咖啡.

---

## Open gaps (ranked)

| Rank | ID | Gap | Mature reference | Verified evidence | Proposed action | Owner | Status |
|------|-----|-----|------------------|-------------------|-----------------|-------|--------|
| 1 | CG-001 | GitHub backlog hygiene (11 PRs, 9 issues) | GitHub: <3 open feature PRs | `cto:governance` GitHub score **47**; 8 draft ghosts | Founder batch per `FOUNDER_ACTION_LIST.md` | Founder | **OPEN** |
| 2 | CG-002 | Outcome metrics unmeasured | Stripe: revenue dashboards with SLAs | `OUTCOME_LOG` date=null; CX/REV frozen at 40/35 | Founder opens `/admin/executive`; `cto:outcomes` | Founder | **OPEN** |
| 3 | CG-003 | DB migrations not applied | Vercel/Supabase: schema version enforced | 3 migrations pending; overlap risk | `OPS_MIGRATION_RUNBOOK` Steps 1–4 | Founder/Ops | **OPEN** |
| 4 | CG-004 | Payment review lacks image persistence | Linear: rich attachment review | Staff had to re-open LINE for screenshots | LINE message id + admin image proxy (#114+) | Agent | **CLOSED** iter-015 |
| 5 | CG-005 | Webhook/cron observability | Cloudflare: job success metrics | `webhook.event_ok` + `cron.completed` shipped | Close #60 webhook portion; cron via `job-runs` | Agent | **CLOSED** iter-014 |
| 6 | CG-006 | Rate limits fail-open | Stripe: always enforce limits | Upstash unset → middleware fail-open; `guest.lookup_denied_rate_limit` logs when enforced | Verify Upstash env on Vercel | Founder | **OPEN** |
| 7 | CG-007 | E2E coverage narrow | Vercel: critical path E2E | 7 Playwright tests; no admin flow | Add admin smoke after gate PASS | Agent | **OPEN** |

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
