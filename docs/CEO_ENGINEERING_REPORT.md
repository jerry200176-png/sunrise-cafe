# CEO Daily Engineering Report — Sunrise Systems

**Date:** 2026-07-10  
**Company:** Sunrise Systems (Sunrise Booking Platform)  
**Production:** https://sunrise-cafe-six.vercel.app  
**Production commit:** `6b1d179` (verified via `/api/version`)  
**Reviewer role:** Founder & CEO  
**Method:** Full repository inspection — GitHub state, CI, branches, PRs, issues, production endpoints, codebase on `main`. Implementation is source of truth.

---

## Executive Summary

**Production status: 🟡 OPERATIONAL WITH KNOWN RISKS**

The platform is live, serving bookings, and core CI on `main` is green. However, engineering workspace health is **poor due to process debt, not product failure**:

| Signal | Status |
|--------|--------|
| Production uptime | ✅ Healthy (`/api/booking-health` ok) |
| `main` CI (latest) | ✅ Passing (lint, 84 tests, build, E2E) |
| Open draft PRs | ⚠️ **9 stacked drafts** (#69–#77), ~12,000+ lines unmerged |
| Security PR ready | ⚠️ **PR #69 CI green, not merged** — fixes live production gaps |
| Phase program PRs | 🔴 **CI failing** (#70–#74) — gitleaks/history errors on parallel branches |
| Dependabot PRs | 🔴 **CI failing** (#64, #65) |
| Release hygiene | ⚠️ Tags (v1.1.0) diverge from CHANGELOG (RC2) |
| Dependabot alerts | 🔴 **Disabled** on repository |
| Production security gaps | 🔴 Client can forge booking price/status; admin auth fail-open |

**CEO decision required today:** Stop parallel phase development. Merge security fixes. Cancel or archive the phase stack. Focus engineering on one production-ready path.

**Estimated engineering debt cost:** 2–4 weeks of cleanup to restore a single trustworthy `main` line — less than continuing 9 parallel draft PRs.

---

## Repository Snapshot

### Git & Branches

| Item | Count / State |
|------|---------------|
| Remote branches | 12 (`main` + 9 cursor/* + 2 dependabot/*) |
| Local branches | 10 |
| Recent `main` commits | RC2-P2 docs, verify-production fix, RC2-P1 merge |
| Merge conflicts | None detected on PR #69 (MERGEABLE/CLEAN) |
| Stale branches | `cursor/phase2` through `phase8` (draft, unmerged, CI red) |

### Pull Requests

| PR | Title | Base | State | CI | Action |
|----|-------|------|-------|-----|--------|
| **#69** | P0 security hardening | `main` | Draft OPEN | ✅ Pass | **MERGE** (after review) |
| #70 | Phase 2 reliability | `main` | Draft OPEN | ❌ Fail | Cancel/rebase selectively |
| #71 | Phase 3 enterprise | `main` | Draft OPEN | ❌ Fail | **CANCEL** |
| #72 | Phase 4 growth/BI | `main` | Draft OPEN | ❌ Fail | **CANCEL** |
| #73 | Phase 5 growth engine | phase4 | Draft OPEN | Unknown | **CANCEL** |
| #74 | Phase 6 governance | phase5 | Draft OPEN | Unknown | **CANCEL** |
| #75 | Phase 7 enterprise/RBAC | phase6 | Draft OPEN | Unknown | Cherry-pick later |
| #76 | Phase 8 docs | phase7 | Draft OPEN | Unknown | Archive content |
| **#77** | CTO first-principles docs | `main` | Draft OPEN | ✅ Pass | **MERGE** (docs only) |
| #64 | Dependabot production deps | `main` | OPEN | ❌ Fail | Fix CI, then merge |
| #65 | Dependabot dev deps | `main` | OPEN | ❌ Fail | Fix CI, then merge |

### Issues

| State | Count | Notes |
|-------|-------|-------|
| Open | 9 | #54 epic, #67 guest auth, #53 payment, #59–#63 P2/P3 |
| Closed (recent) | Many | #55, #56, #58, #68 correctly closed post-RC2 |

**No milestones or project boards configured.**

### CI / GitHub Actions

| Workflow | Latest `main` | Notes |
|----------|---------------|-------|
| CI (lint, test, build) | ✅ Success | 84 unit tests |
| Playwright smoke | ✅ Success | Mocked E2E |
| Verify Production | ✅ Success (after fix) | One failure on `5a42c39`, fixed in `4385ed9` |
| `npm audit` | ⚠️ `continue-on-error: true` | Non-blocking |
| gitleaks | ⚠️ `continue-on-error: true` | Phase PRs fail here anyway |
| `verify:migrations` | ❌ Not on `main` | Only on phase branches |

### Security Posture

| Control | Status |
|---------|--------|
| Dependabot alerts | **Disabled** (GitHub API 403) |
| Code scanning | Not accessible / not enabled |
| Secret scanning (gitleaks) | Runs but non-blocking |
| Admin API auth | Partial (RC2-P1/P2 on `main`) |
| RBAC | **Not on `main`** (only on phase7 branch) |
| Guest API | Phone-only lookup (#67 open) |
| Rate limiting | Optional (Upstash); fail-open without config |

### Production Deployment

| Check | Result |
|-------|--------|
| `/api/version` | `commit: 6b1d179` — matches `main` |
| `/api/booking-health` | `ok: true`, exposes `serviceRoleConfigured: true` |
| Sentry | Optional (silent without DSN) |
| Migrations | **23 SQL files** on `main`; manual apply; no phase7 migrations in prod |

### Tests & Build

| Metric | `main` | Phase7 branch (unmerged) |
|--------|--------|--------------------------|
| Unit tests | 84 | 158 |
| API route tests | 0–1 | 1+ |
| E2E tests | 11 (mocked) | 11 |
| TODO/FIXME in `src/` | 0 | — |

### Documentation

| `main` | Phase branches |
|--------|----------------|
| 14 docs files | 38+ docs files |
| CHANGELOG through RC2-P2 | Phase 4–8 architecture sprawl |

---

## Findings by Priority

---

## 1. CRITICAL — Must Fix Immediately

### C1. Guest booking POST accepts client-controlled `status` and `total_price`

| Field | Detail |
|-------|--------|
| **Evidence** | `src/app/api/reservations/route.ts` L58–61, L137–138: `status: status ?? "pending"`, `total_price: totalPrice ?? null` from request body |
| **Business impact** | Attacker can create `confirmed` bookings at NT$0 — bypasses deposit workflow, corrupts revenue reports, enables fraud |
| **Engineering impact** | Undermines payment review queue and deposit deadline automation |
| **Risk if ignored** | Direct revenue loss, operational chaos, reputational damage if exploited |
| **Recommended action** | **Merge PR #69** (includes server-side price computation and forced `pending` status) OR cherry-pick `reservations/route.ts` fix today |
| **Effort** | S (already implemented in PR #69) |
| **Dependencies** | None — deploy immediately after merge |

---

### C2. Admin auth fail-open when `ADMIN_PASSWORD` unset

| Field | Detail |
|-------|--------|
| **Evidence** | `src/lib/admin-api-auth.ts` L53: `if (!process.env.ADMIN_PASSWORD) return null;` — all admin APIs pass |
| **Business impact** | Misconfigured Vercel env = entire admin API and PII exposed to internet |
| **Engineering impact** | RC2 security model assumes password always set; no production guard |
| **Risk if ignored** | Catastrophic data breach on env rotation mistake |
| **Recommended action** | Merge PR #69 (`isAdminAuthRequired()` deny-by-default in production) |
| **Effort** | S (in PR #69) |
| **Dependencies** | Verify `ADMIN_PASSWORD` and `SESSION_SECRET` set in Vercel before deploy |

---

### C3. PR #69 (security hardening) ready but unmerged for 7+ hours

| Field | Detail |
|-------|--------|
| **Evidence** | PR #69: CI ✅, MERGEABLE CLEAN, 477 additions, 1 commit ahead of `main`; fixes overlap with RC2-P2 but adds unique server-side pricing + deny-by-default |
| **Business impact** | Production running known-vulnerable code while fix sits in draft |
| **Engineering impact** | Team velocity illusion — work done but not shipped |
| **Risk if ignored** | Continued exposure; team builds more unmerged branches on top |
| **Recommended action** | **Remove draft status. Merge #69 to `main` today.** Deploy. Verify production. |
| **Effort** | S (1 hour including deploy verification) |
| **Dependencies** | CEO approval; no conflicting phase merge |

---

### C4. Nine parallel draft PRs creating engineering paralysis

| Field | Detail |
|-------|--------|
| **Evidence** | PRs #70–#76: 3,000–5,000 lines each; bases split (`main` vs stacked phase4→7); CI red on #70–#74; duplicate security/RBAC/analytics work |
| **Business impact** | Zero customer value from unmerged code; founder cannot tell what is production vs planned |
| **Engineering impact** | Merge conflicts inevitable; gitleaks failures on shallow branch history; 74→158 test gap between main and tip |
| **Risk if ignored** | Months of "almost done" work; production never receives fixes |
| **Recommended action** | **Cancel/close PRs #71–#76.** Selectively re-open cherry-picked work after Wave 1 security ships |
| **Effort** | S (administrative, today) |
| **Dependencies** | CEO strategy decision (see CTO report) |

---

### C5. Dependabot alerts disabled

| Field | Detail |
|-------|--------|
| **Evidence** | GitHub API: `"Dependabot alerts are disabled for this repository"`; Issue #58 closed claiming enabled |
| **Business impact** | Unknown vulnerable dependencies in production |
| **Engineering impact** | Issue #58 checklist item is false; `npm audit` non-blocking in CI |
| **Risk if ignored** | Supply chain vulnerability in Next.js/React/Supabase client |
| **Recommended action** | Enable Dependabot alerts in GitHub repo settings today; fix PRs #64/#65 or manual audit |
| **Effort** | S (settings) + M (dependency updates) |
| **Dependencies** | GitHub admin access |

---

## 2. HIGH PRIORITY

### H1. Guest APIs expose bookings by phone only (IDOR / enumeration)

| Field | Detail |
|-------|--------|
| **Evidence** | `src/app/api/my-bookings/route.ts` L7–8: `GET ?phone=` returns active reservations; Issue #67 open |
| **Business impact** | Know phone → see/cancel bookings; privacy violation under Taiwan PDPA |
| **Engineering impact** | Cancel requires `booking_code` (better); lookup does not |
| **Risk if ignored** | Guest data leak; support/legal exposure |
| **Recommended action** | Require `phone` + `booking_code` for my-bookings; rate limit aggressively |
| **Effort** | M |
| **Dependencies** | PR #70 has guest-auth work — cherry-pick, do not merge whole phase2 |

---

### H2. `/api/booking-health` leaks infrastructure details publicly

| Field | Detail |
|-------|--------|
| **Evidence** | Production response: `{"serviceRoleConfigured":true,...}`; PR #69 redacts for non-admin |
| **Business impact** | Low direct; aids attacker reconnaissance |
| **Engineering impact** | Violates least-information principle |
| **Risk if ignored** | Minor; combined with C2 is worse |
| **Recommended action** | Merge with PR #69 or quick patch: public response = `{ok: true}` only |
| **Effort** | S |
| **Dependencies** | C3 merge |

---

### H3. Double-booking race condition (read-then-write)

| Field | Detail |
|-------|--------|
| **Evidence** | `hasSlotConflict()` check before insert without row lock; Issue in ENGINEERING_ASSESSMENT (PR #69 branch); DB exclusion constraint exists as backstop |
| **Business impact** | Two guests booked same room same time → customer conflict at check-in |
| **Engineering impact** | Exclusion constraint may 500 one guest instead of graceful reject |
| **Risk if ignored** | Rare but high severity when it happens (peak holiday) |
| **Recommended action** | Cherry-pick transaction lock from PR #70; add integration test |
| **Effort** | M |
| **Dependencies** | None |

---

### H4. Phase7 RBAC (158 tests, admin users) stranded on unmerged branch

| Field | Detail |
|-------|--------|
| **Evidence** | `main` has 0 `requirePermission` usages; PR #75 on phase6 base, 8 commits, not mergeable to `main` cleanly |
| **Business impact** | Cannot safely hire staff; shared password remains only control |
| **Engineering impact** | RBAC tables may not exist in production DB |
| **Risk if ignored** | Staff account = full admin access |
| **Recommended action** | After C3: cherry-pick RBAC from phase7 as **new small PRs** to `main` (not merge #75 wholesale); apply migrations manually |
| **Effort** | L (split into 3–5 PRs) |
| **Dependencies** | C4 cancel phase stack; migration apply |

---

### H5. Manual database migrations — phase7 schema not in production

| Field | Detail |
|-------|--------|
| **Evidence** | `main`: 23 migration files, no `migration-phase7-*`; `docs/MIGRATIONS.md` absent on `main`; phase branches have 36 migrations + manifest |
| **Business impact** | Code/DB drift if phase work deployed piecemeal |
| **Engineering impact** | RBAC, audit, job_runs tables may not exist in prod |
| **Risk if ignored** | Deploy RBAC code → runtime errors / migration_required flags |
| **Recommended action** | Audit production Supabase schema vs `main` code; document applied migrations; never deploy phase7 code without matching SQL |
| **Effort** | M (ops audit) |
| **Dependencies** | Supabase dashboard access |

---

### H6. Release versioning inconsistent

| Field | Detail |
|-------|--------|
| **Evidence** | Git tags: v0.9.0 (marked Latest), v1.0.0, v1.1.0; CHANGELOG uses RC1/RC2-P1/RC2-P2; production `/api/version` returns `deployed: v2` |
| **Business impact** | Cannot communicate releases to operators; rollback confusion |
| **Engineering impact** | verify-production compares SHA not semver |
| **Risk if ignored** | Incident response slows |
| **Recommended action** | Tag `main` as `v1.2.0-rc2` or `v2.0.0`; align CHANGELOG, `/api/version`, GitHub releases |
| **Effort** | S |
| **Dependencies** | Post C3 merge |

---

### H7. Epic #54 checklist stale — false sense of completion

| Field | Detail |
|-------|--------|
| **Evidence** | Epic #54 lists P0 items (deposit deadline, Dependabot) — #55 and #58 closed but Dependabot still disabled |
| **Business impact** | Leadership believes P0 done; gaps remain |
| **Engineering impact** | Wrong prioritization |
| **Risk if ignored** | Unclosed security work |
| **Recommended action** | Update epic #54 checklist; close sub-items accurately |
| **Effort** | S |
| **Dependencies** | C5 |

---

## 3. MEDIUM PRIORITY

### M1. Dependabot PRs #64/#65 failing CI

| Evidence | CI failure on lint/build (likely breaking dep updates) |
| Business impact | Stale dependencies; security patches delayed |
| Action | Rebase, fix breakages, merge in controlled window |
| Effort | M |
| Dependencies | C5 enabled |

### M2. Phase PR CI failures (gitleaks git history)

| Evidence | `gitleaks-action` fails: `unknown revision` on stacked branch diffs (#70–#74) |
| Business impact | None if PRs cancelled |
| Action | Fix gitleaks config OR cancel phase PRs (recommended) |
| Effort | S |
| Dependencies | C4 |

### M3. API test coverage near zero on `main`

| Evidence | 84 lib tests; ~0 API route tests on `main` |
| Business impact | Security regressions ship undetected (proven by C1 living in prod) |
| Action | Add permission + reservation POST tests with each security PR |
| Effort | M |
| Dependencies | C3 |

### M4. `my-bookings` returns PII without booking_code

| Evidence | Part of H1; separate UX track for guest query flow |
| Action | Update `/book/query` to require code; deprecate phone-only lookup |
| Effort | M |
| Dependencies | H1 |

### M5. Waitlist marks notified even if LINE fails

| Evidence | Documented in ENGINEERING_ASSESSMENT (PR #69 branch) |
| Business impact | Lost demand recovery |
| Action | Cherry-pick from phase2 if present; else fix in isolation |
| Effort | S |
| Dependencies | None |

### M6. Documentation sprawl and contradictions

| Evidence | 14 docs on `main`; 38+ on phase branches; CTO/Phase8 contradict on catalog auth, RBAC % |
| Business impact | Wrong engineering decisions |
| Action | Merge PR #77 (CTO docs); archive phase docs; create `IMPLEMENTATION_TRUTH.md` |
| Effort | S |
| Dependencies | C4 |

### M7. `verify-production` transient failure on deploy

| Evidence | Run `29007659655` failed; fixed in next commit |
| Business impact | None currently |
| Action | Monitor; add retry to workflow |
| Effort | S |
| Dependencies | None |

### M8. No `verify:migrations` on `main`

| Evidence | Script exists only on phase branches |
| Business impact | Migration drift undetected in CI |
| Action | Cherry-pick manifest from phase6 after stack cancelled |
| Effort | S |
| Dependencies | H5 schema audit |

---

## 4. LOW PRIORITY

### L1. Open P2/P3 issues (#59–#63, #53)

| Evidence | E2E expansion, structured logging, payment provider abstraction, bank CSV, AI workflow docs |
| Action | Keep open; do not schedule until Wave 1–2 complete |
| Effort | Various |
| Dependencies | CEO strategy |

### L2. `npm audit` and gitleaks non-blocking in CI

| Evidence | `continue-on-error: true` in ci.yml |
| Action | Make blocking after C5/C1 resolved |
| Effort | S |

### L3. Node 20 deprecation warning in GitHub Actions

| Evidence | CI logs warn Node 20 deprecated on runners |
| Action | Bump ci.yml to Node 22 |
| Effort | S |

### L4. Admin hub 960-line monolith page

| Evidence | `src/app/admin/page.tsx` size per prior review |
| Action | Decompose after operator UX wave |
| Effort | M |

### L5. E2E tests fully mocked — no real Supabase integration

| Evidence | `e2e/helpers/api-mocks.ts` |
| Action | One staging integration test job |
| Effort | M |
| Dependencies | Staging Supabase project |

### L6. print-bridge per-store deployment burden

| Evidence | README; not in Vercel |
| Action | Measure ordering usage 90 days; deprecate if unused |
| Effort | S (measurement) |

---

## 5. NICE TO HAVE

### N1. Merge CTO strategy docs (PR #77)

Docs-only; CI green. Informs leadership; no production risk.

### N2. Archive phase 4–8 architecture documents to `docs/archive/`

Preserve history without polluting active guidance.

### N3. GitHub milestones for Wave 1–2 execution

Lightweight project tracking without enterprise overhead.

### N4. `/api/version` semver alignment with git tags

Operator-facing clarity.

### N5. Accessibility improvements (issue #44 closed but admin a11y weak)

Defer unless franchise contract requires.

---

## Duplicated & Abandoned Work

| Duplication | Evidence | Recommendation |
|-------------|----------|----------------|
| Security hardening in **PR #69** vs **RC2-P2 on main** | Overlap on catalog auth; #69 adds pricing + deny-by-default | Merge #69; close overlap as done |
| **PR #70** (phase2) vs **#69** | Guest auth, double-booking, timezone | Cherry-pick unique pieces after #69 |
| **PR #72–#76** vs **CTO Wave 1–3** | BI, experiments, RBAC, audit, docs | Cancel stack; re-implement per CTO plan in small PRs |
| **PR #76** (phase8) vs **PR #77** (CTO) | Both architecture reviews | Merge #77; close #76 |
| **ENGINEERING_ASSESSMENT** on #69 vs stale items on main | P0-1 catalog auth fixed in RC2-P2 but assessment says open | Update post-merge |
| **Issue #58** vs reality | Closed but Dependabot disabled | Reopen or update |

### Stale branches safe to delete (after PR close)

- `cursor/phase3-enterprise-3a90` through `cursor/phase8-platform-review-3a90` (after content cherry-picked)
- `dependabot/*` branches (after merge or close)

### Dead code candidates (verify usage before delete)

- Experiments framework (if not used in prod ops)
- `business_actions` / recommendations (phase7 only)
- `demand_snapshots` cron (if no weekly review)

---

## Recommended Execution Roadmap

**Principle:** Production incidents → Security → Data integrity → Customer bugs → Reliability → DX → Debt → Features

This **replaces** the Phase 4–8 program and challenges its priority.

---

### TODAY (CEO approval required)

| # | Action | Owner | Outcome |
|---|--------|-------|---------|
| 1 | **Merge PR #69** to `main` | Engineering | Close C1, C2, H2 |
| 2 | **Deploy + verify** production (`/api/version`, booking test, admin login) | Engineering | Confirm fix live |
| 3 | **Enable Dependabot alerts** in GitHub settings | CEO/Admin | Close C5 |
| 4 | **Close PRs #71–#76** as cancelled (comment: superseded by CTO plan) | CEO | Close C4 |
| 5 | **Merge PR #77** (CTO docs) | CEO | Strategy alignment |
| 6 | **Update Epic #54** checklist to reflect true state | Engineering | Close H7 |
| 7 | **Audit production Supabase** applied migrations | Ops | Inform H5 |

### THIS WEEK (Days 2–7)

| Wave | Work | Priority basis |
|------|------|----------------|
| W1 | Cherry-pick guest-auth + double-book from #70 → new PR to `main` | Security + data integrity |
| W2 | Cherry-pick RBAC migration + `requirePermission` rollout (from #75, split 3 PRs) | Security |
| W3 | Fix Dependabot PRs #64/#65 or manual dep update | Security |
| W4 | Tag release v2.0.0; align CHANGELOG | Reliability |
| W5 | Phone+booking_code required for my-bookings (#67) | Security |

### WEEKS 2–4 (After Wave 1 trust)

| Work | Priority basis |
|------|----------------|
| Per-branch `closed_dates` wiring | Data integrity |
| Cron fan-out + failure alerts | Reliability |
| Audit log on mutations | Security |
| Admin nav by role | Customer-facing (staff UX) |
| Migration manifest in CI | Developer productivity |

### MONTH 2+

Only after trust wave complete and CEO confirms Strategy A or A→B:

- KPI simplification
- Staging environment
- Outbox pattern
- Selective phase7/6 cherry-picks (schema governance, data quality)

### CANCELLED (Do not resume)

- Phase 3–6 PR stack as merge units
- Phase 8 enterprise target architecture implementation
- AI platform work (issues #61, epic AI items)
- PaymentProvider abstraction (#63) until gateway decision
- Parallel phase branch development

### POSTPONED

- Partner API / webhooks
- Experiments / demand forecasting infrastructure
- Full admin UI redesign
- Microservices evaluation
- SSO

---

## CEO Decision Matrix

### MERGE today
- ✅ **PR #69** — P0 security (CI green, mergeable)
- ✅ **PR #77** — CTO strategy docs (CI green, docs only)

### CLOSE / CANCEL today
- ❌ **PR #71–#76** — Phase stack (failing CI, strategic misalignment)
- ❌ **Issue #58** sub-item "Dependabot enabled" — reopen until actually enabled

### WAIT (this week, not today)
- ⏸ **PR #70** — cherry-pick only; do not merge wholesale
- ⏸ **PR #64/#65** — after CI fix
- ⏸ **PR #75 RBAC** — split into small PRs after #69

### ARCHIVE
- 📦 Phase 4–8 docs from closed PRs → `docs/archive/`
- 📦 `docs/PHASE8_*`, `ENTERPRISE_TARGET_ARCHITECTURE.md` (from #76) as reference only

### DELETE (branches, after 30 days)
- Remote branches `cursor/phase3` through `cursor/phase8` after cherry-pick complete

---

## Production Risk Summary

| Risk | Severity | Mitigated by |
|------|----------|--------------|
| Forged booking price/status | 🔴 Critical | Merge #69 today |
| Admin fail-open | 🔴 Critical | Merge #69 today |
| Phone enumeration | 🟠 High | Issue #67 this week |
| Double-booking race | 🟠 High | Cherry-pick from #70 |
| Unmerged work confusion | 🟠 High | Close phase PRs today |
| Schema drift | 🟠 High | Supabase audit this week |
| Cron silent failure | 🟡 Medium | Wave 2 |
| Dependency vulnerabilities | 🟡 Medium | Enable Dependabot today |

---

## Engineering Health Scorecard

| Dimension | Score | Target (30 days) |
|-----------|------:|-----------------:|
| Production readiness | **62** | 85 |
| Security | **58** | 85 |
| Release hygiene | **55** | 75 |
| CI/CD reliability | **72** | 80 |
| Code integration | **40** | 75 |
| Test confidence | **65** | 75 |
| Documentation accuracy | **50** | 70 |
| Engineering focus | **35** | 80 |

**Overall engineering health: 55/100 — 🔴 Needs immediate leadership intervention**

The low **engineering focus** score reflects 9 draft PRs, 3 parallel architecture programs, and critical security fixes sitting unmerged while new phases were built.

---

## CEO Bottom Line

> **You are not blocked by technology. You are blocked by shipping discipline.**

The team built the right fixes in PR #69 and then kept building parallel phase branches that cannot merge. Production runs code with known fraud vectors. The highest-ROI action today is **merge security, cancel phases, deploy** — not another architecture document.

**Approve today:**
1. Merge #69 + deploy
2. Close #71–#76
3. Enable Dependabot
4. Merge #77

**Total time to materially reduce production risk: < 4 hours.**

---

*No code changes were made in this review. Awaiting CEO approval before implementation.*
