# Engineering Dashboard — Sunrise Systems

**CTO Operating System · Single Source of Truth**  
**Last updated:** 2026-07-10 Round 2  
**Production:** https://sunrise-cafe-six.vercel.app · `v2.1.0` · commit `2c1c43c`

---

## Health Scorecard

| Dimension | Score | Δ today | Target |
|-----------|------:|--------:|-------:|
| **Production stability** | 82 | +12 | 95 |
| **Security** | 78 | +20 | 95 |
| **Revenue reliability** | 75 | +5 | 90 |
| **Customer experience** | 72 | +2 | 85 |
| **Developer experience** | 68 | +15 | 85 |
| **Overall** | **76** | +14 | 90 |

---

## Production Status

| Signal | Status | Detail |
|--------|--------|--------|
| Deploy | 🟢 | `/api/version` commit matches `main` |
| Health | 🟢 | `/api/booking-health` → `{"ok":true}` |
| CI `main` | 🟢 | Lint + 113 tests + build + E2E |
| Verify Production | 🟢 | Post-deploy smoke passing |
| DB migrations | 🟡 | Overlap + RBAC SQL **operator must apply** |

---

## GitHub Inventory

### Pull Requests

| PR | State | Action |
|----|-------|--------|
| #69, #78, #79, #80 | ✅ MERGED | Wave 1 complete |
| #77 | OPEN duplicate | **Close** (superseded by #78) |
| #70–#76 | OPEN draft | **Close** (shipped via #79 or cancelled) |
| #64, #65 | OPEN dependabot | Fix CI → merge (security deps) |

### Branches (remote)

| Branch | Status |
|--------|--------|
| `main` | ✅ Production |
| `dependabot/*` (2) | Open PRs |
| `cursor/*` | ✅ **Deleted** (12 stale branches removed) |

### Issues (open: 7)

| Issue | Priority | CTO verdict |
|-------|----------|-------------|
| #54 Epic Production Excellence | P1 | Update checklist; close completed items |
| #53 Payment flow optimization | P1 | Keep — revenue |
| #59 E2E booking+payment | P2 | Partially done; expand later |
| #60 Structured logging | P2 | After stability |
| #61 AI workflow docs | P3 | **Defer** |
| #62 Bank CSV import | P2 | Revenue ops |
| #63 PaymentProvider abstraction | P3 | **Defer** until gateway decision |

### Releases

| Tag | Date | Notes |
|-----|------|-------|
| `v2.1.0` | 2026-07-10 | Wave 1: #69 + #79 |
| v1.1.0 | 2026-05-16 | Legacy |

---

## Round 2 Actions Completed

| Action | Result |
|--------|--------|
| Delete 12 stale `cursor/*` remote branches | ✅ |
| Create `ENGINEERING_DASHBOARD.md` (this file) | ✅ |
| Create `IMPLEMENTATION_TRUTH.md` | ✅ |
| Wave 2 RBAC foundation branch | 🔄 PR pending |
| Close draft PRs #70–#77 | ⚠️ Bot lacks permission — **founder: close in GitHub UI** |

---

## Remaining Risks

| Risk | Severity | Mitigation | Owner |
|------|----------|------------|-------|
| RBAC not enforced on routes | 🔴 High | Wave 2b after foundation merge | Eng |
| Overlap migration not applied | 🟠 High | Operator SQL in Supabase | Ops |
| 7 stale open PRs confuse team | 🟡 Med | Manual close | Founder |
| Dependabot disabled | 🟡 Med | GitHub Settings → Security | Founder |
| `staff` can approve payments | 🔴 High | Wave 2b `requirePermission` | Eng |
| Per-branch closed dates wrong | 🟠 Med | Wave 3 | Eng |

---

## Blockers

| Blocker | Type | Resolution |
|---------|------|------------|
| GitHub bot cannot `closePullRequest` | Permission | Founder closes #70–#77 manually (2 min) |
| Branch protection requires CI | Process | Normal — wait for green checks |
| RBAC needs DB migration before users | Ops | Apply `migration-phase7-rbac.sql` after Wave 2 |

---

## Active Work Queue (ROI-sorted)

| # | Work | Value pillar | ROI rationale | Effort | Status |
|---|------|--------------|---------------|--------|--------|
| 1 | **Wave 2: RBAC foundation** | Security | Enables safe staff hiring | S | 🔄 PR open |
| 2 | **Wave 2b: Payment route RBAC** | Security | Stops staff approving payments | S | Next |
| 3 | **Apply DB migrations** | Production | Code assumes constraints exist | S | Ops |
| 4 | **Close stale PRs** | DX | Single truth; stop confusion | XS | Founder |
| 5 | **Dependabot #64/#65** | Security | Dependency CVEs | M | Queued |
| 6 | **Per-branch closed_dates** | Revenue | Wrong availability = lost bookings | S | Wave 3 |
| 7 | **Cron failure alerts** | Production | Silent reminder failures | S | Wave 3 |

**Deferred:** AI docs (#61), PaymentProvider (#63), phase 4–8 platform program, microservices.

---

## Next Round Target

After Wave 2 + 2b merge:
- Security score → **88**
- Close payment privilege escalation
- Bootstrap first named admin user
- Update this dashboard Round 3

---

## Document Hierarchy (SSOT)

```
docs/ENGINEERING_DASHBOARD.md  ← you are here (ops status)
docs/IMPLEMENTATION_TRUTH.md   ← what code actually does
docs/CTO_STRATEGY.md           ← 3–5 year strategy
docs/CEO_ENGINEERING_REPORT.md ← audit trail
docs/MIGRATIONS.md             ← DB apply order
CLAUDE.md                      ← operator runbook
```

Phase 4–8 architecture docs: **obsolete** — do not use for planning.

---

## CI / Deploy Pipeline

```
PR → Lint + Test(113) + Build + gitleaks + Playwright
main push → CI + Verify Production (SHA poll)
Vercel → auto deploy main
```

---

*Next update: after Wave 2 PR merge.*
