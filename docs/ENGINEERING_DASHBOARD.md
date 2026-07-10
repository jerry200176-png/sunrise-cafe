# Engineering Dashboard — Sunrise Systems

**CTO Operating System · Single Source of Truth**  
**Last updated:** 2026-07-10 Round 3  
**Production:** https://sunrise-cafe-six.vercel.app · `v2.2.0` · commit `6ffb755`

---

## Health Scorecard

| Dimension | Score | Δ Round 3 | Target |
|-----------|------:|----------:|-------:|
| **Production stability** | 84 | +2 | 95 |
| **Security** | 88 | +10 | 95 |
| **Revenue reliability** | 75 | — | 90 |
| **Customer experience** | 72 | — | 85 |
| **Developer experience** | 74 | +6 | 85 |
| **Overall** | **82** | +6 | 90 |

---

## Production Status

| Signal | Status | Detail |
|--------|--------|--------|
| Deploy | 🟢 | `main` auto-deploy via Vercel |
| Health | 🟢 | `/api/booking-health` → `{"ok":true}` |
| CI `main` | 🟢 | Lint + **119 tests** + build + E2E |
| Verify Production | 🟢 | SHA smoke after each merge |
| DB migrations | 🟡 | **Operator action:** overlap + RBAC SQL |

---

## GitHub Inventory (live)

### Merged today
#69 · #78 · #79 · #80 · #81 · #82

### Must close manually (bot lacks permission)
#70–#77 — obsolete drafts

### Open
#64 · #65 — dependabot (CI red)

### Branches
`main` only + `dependabot/*` (cursor/* **deleted**)

### Issues open: 7
See `IMPLEMENTATION_TRUTH.md` for triage.

### Releases
| Tag | Notes |
|-----|-------|
| **v2.2.0** | Wave 2 RBAC + payment enforcement |
| v2.1.0 | Wave 1 security + guest auth |

---

## Round 3 Completed

| Action | Result |
|--------|--------|
| CTO SSOT: `ENGINEERING_DASHBOARD` + `IMPLEMENTATION_TRUTH` | ✅ |
| Delete 12 stale remote branches | ✅ |
| **#81** RBAC foundation | ✅ MERGED |
| **#82** Payment route RBAC | ✅ MERGED |
| Stale PR close (#70–#77) | ⚠️ Founder manual |

---

## Remaining Risks

| Risk | Severity | Status |
|------|----------|--------|
| `staff` can approve payments | 🔴 | ✅ **Fixed #82** |
| RBAC tables not in prod DB | 🟠 | Apply migration |
| Overlap constraint not in prod DB | 🟠 | Apply migration |
| Reservation routes lack RBAC | 🟠 | Wave 3 |
| Per-branch closed_dates | 🟠 | Wave 3 |
| 7 stale open PRs | 🟡 | Founder close |
| Dependabot disabled | 🟡 | Founder enable |

---

## Blockers

| Blocker | Owner |
|---------|-------|
| Close PRs #70–#77 | Founder (2 min) |
| Apply `migration-phase7-rbac.sql` | Ops |
| Apply `migration-reservations-no-overlap.sql` | Ops |

---

## Active Queue (company value order)

| # | Work | Pillar | ROI | Status |
|---|------|--------|-----|--------|
| 1 | Apply DB migrations | Production | Code/DB parity | **Ops now** |
| 2 | Close stale PRs #70–#77 | DX | Single truth | Founder |
| 3 | **Wave 3: reservation RBAC** | Security | Staff field-level control | Next eng |
| 4 | **Wave 3: per-branch closed_dates** | Revenue | Correct availability | Queued |
| 5 | Dependabot #64/#65 | Security | CVE patches | Queued |
| 6 | Cron failure alerts | Production | Silent failures | Queued |

**Deferred:** AI (#61), PaymentProvider (#63), phase 4–8 programs.

---

## Why Wave 3 reservations RBAC is next highest ROI

Payment routes are secured, but `staff` can still full-PATCH reservations and edit prices. That is the next privilege-escalation surface after payments — blocks safe multi-user ops.

---

## Document Hierarchy

```
docs/ENGINEERING_DASHBOARD.md  ← ops status (this file)
docs/IMPLEMENTATION_TRUTH.md   ← code enforcement truth
docs/CTO_STRATEGY.md           ← strategy
docs/MIGRATIONS.md             ← DB order
CLAUDE.md                      ← operator handbook
```

---

*Round 4 update: after Wave 3 + migration confirm.*
