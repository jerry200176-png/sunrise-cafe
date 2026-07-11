# GitHub Triage Registry

**Updated:** 2026-07-11 15:28 CST  
**Gate:** BLOCK

Curated issue/PR actions. Bot cannot close — Founder executes [`FOUNDER_ACTION_LIST.md`](./FOUNDER_ACTION_LIST.md).

---

## Issues

| # | Title | Action | Status |
|--:|-------|--------|--------|
| 59 | Playwright E2E | **CLOSE** — shipped #97 | open → close |
| 62 | Bank CSV import | **CLOSE** — duplicate MVP | open → close |
| 53 | Payment flow optimization | **KEEP** P1 | open |
| 54 | Production Excellence epic | **KEEP** — defer children | open |
| 60 | Structured logging | **KEEP** P2 — partial ops-log | open |
| 61 | AI workflow docs | **DEFER** P3 | open |
| 63 | PaymentProvider abstraction | **DEFER** P3 | open |
| 95 | Founder ops batch | **KEEP** P0 ops | open |
| 99 | Integrated deposit capture | **KEEP** strategic | open |

## Pull requests

| # | Action | Reason |
|--:|--------|--------|
| 70–77 | **CLOSE** | Phase draft ghosts; merged via #79–#85 |
| 89 | **CLOSE** | Docs-only inbox; stale |
| 90 | **CLOSE** | Dependabot production majors |
| 91 | **CLOSE** | Dependabot dev majors |

## Branches

Remote should be: `main`, `dependabot/*` only. Delete merged `cursor/*` after PR merge.

---

## GitHub Hygiene Audit
_Generated: 2026-07-11 15:29 CST

**Repository:** jerry200176-png/sunrise-cafe

### Open Issues (9)

| # | Title | Recommended action | Evidence |
|--:|-------|-------------------|----------|
| 99 | Product: integrated deposit capture (Stripe/LINE P | KEEP — strategic; evidence-based #99 | |
| 95 | Founder Ops Batch — migrations, secrets, GitHub cl | KEEP — Founder ops batch (migrations) | |
| 63 | P3: PaymentProvider abstraction for future gateway | DEFER P3 — no gateway contract | |
| 62 | P2: Bank statement CSV import for payment reconcil | CLOSE — duplicate; reconcile MVP on main | |
| 61 | P2: AI-readable workflow docs (docs/workflows/) | DEFER P3 — Work Gate weak (DX only) | |
| 60 | P2: Structured logging and Sentry breadcrumbs for  | KEEP P2 — ops-log started; extend to full webhook | |
| 59 | P2: Playwright E2E tests for booking and payment f | CLOSE — shipped #97 E2E | |
| 54 | Epic: Production Excellence & AI-assisted Developm | KEEP epic — defer; child items tracked separately | |
| 53 | Payment Flow Optimization Without Paid Gateway | KEEP P1 — payment flow; needs OUTCOME_LOG first | |

### Open Pull Requests (12, draft: 8, non-dependabot: 10)

| # | Branch | Action | Reason |
|--:|--------|--------|--------|
| 112 | cursor/auto-doc-drift-fix-886a36c-3a90 | REVIEW | Verify CI + Work Gate |
| 91 | dependabot/npm_and_yarn/dev-dependencies-a756a62f1e | REVIEW | Dev deps only; patch minors if CI green |
| 90 | dependabot/npm_and_yarn/production-dependencies-69ab5e432b | **CLOSE** | Major bumps (lucide 1.x, types 26) — DL-012 |
| 89 | cursor/inbox-round7-close-3a90 | **CLOSE** | Superseded ghost/phase draft; content on main |
| 77 | cursor/cto-first-principles-3a90 | **CLOSE** | Superseded ghost/phase draft; content on main |
| 76 | cursor/phase8-platform-review-3a90 | **CLOSE** | Superseded ghost/phase draft; content on main |
| 75 | cursor/phase7-enterprise-platform-3a90 | **CLOSE** | Superseded ghost/phase draft; content on main |
| 74 | cursor/phase6-platform-governance-3a90 | **CLOSE** | Superseded ghost/phase draft; content on main |
| 73 | cursor/phase5-growth-engine-3a90 | **CLOSE** | Superseded ghost/phase draft; content on main |
| 72 | cursor/phase4-growth-platform-3a90 | **CLOSE** | Superseded ghost/phase draft; content on main |
| 71 | cursor/phase3-enterprise-3a90 | **CLOSE** | Superseded ghost/phase draft; content on main |
| 70 | cursor/phase2-reliability-growth-3a90 | **CLOSE** | Superseded ghost/phase draft; content on main |

### Remote branches (5 total, cursor/*: 2)

```
cursor/auto-doc-drift-fix-4d084be-3a90
cursor/auto-doc-drift-fix-886a36c-3a90
dependabot/npm_and_yarn/dev-dependencies-a756a62f1e
dependabot/npm_and_yarn/production-dependencies-69ab5e432b
main
```

**Stale cursor branches (delete if PR merged):**
- `git push origin --delete cursor/auto-doc-drift-fix-4d084be-3a90`
- `git push origin --delete cursor/auto-doc-drift-fix-886a36c-3a90`

### Bot permissions
❌ Bot **cannot** close issues/PRs — Founder must execute triage in [`FOUNDER_ACTION_LIST.md`](./FOUNDER_ACTION_LIST.md)
