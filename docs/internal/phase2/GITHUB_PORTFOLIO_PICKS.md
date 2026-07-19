# GitHub Portfolio Picks — Sunrise Cafe (Phase 2)

**Repo:** [jerry200176-png/sunrise-cafe](https://github.com/jerry200176-png/sunrise-cafe)  
**Snapshot:** `/tmp/phase2-github-portfolio.json` (2026-07-19)  
**Issue:** [#239 Phase 2](https://github.com/jerry200176-png/sunrise-cafe/issues/239)

---

## Queue snapshot (Sunrise)

| Metric | Count |
|--------|------:|
| Open issues | 2 |
| Open PRs | 5 |
| Draft PRs | 1 (#219) |
| Stale PRs | 0 |
| Blocked PRs | 0 |
| Failed CI PRs | 0 |
| `needs_decision` | 0 |

**Issue classes (open):** UX friction ×1 (#239), technical debt ×1 (#211 Founder Decision Queue).

**Open PRs:** #235 (deps prod), #219 (draft ops LINE cron), #218 (deps dev), #216 (maturity A-gates), #200 (booking fetch timeout).

AllTrue queue is **out of scope** for Sunrise picks but noted in portfolio JSON for CEO rollup (63 issues, 15 PRs, heavy Founder-decision backlog).

---

## Active track limit (Phase 2 rule)

Each project runs at most:

- **1** reliability / data-risk item  
- **1** user-facing product / UX item  
- **1** read-only OSS research task (see `JOURNEY_AND_OSS_BRIEF.md`)

**Do not merge PRs from this task** — document close-first actions only.

---

## Pick 1 — Highest-risk reliability item

### **Live outcome operator path (Issue #239 Part 1)**

| Field | Detail |
|-------|--------|
| **Item** | Complete operator-only production outcome read path for CEO evidence |
| **Why highest risk** | Phase 1 **Conditional PASS** on Outcome Truth — live counts still depend on `CTO_OUTCOME_SECRET`; dashboard must not treat access failure as zero activity |
| **Evidence** | #239 body: "Live outcomes + GitHub portfolio + design SSOT"; `OUTCOME_LOG.md` pipeline vs Phase 2 exit gate; middleware Bearer auth on `/api/ops/ceo-evidence` |
| **Work in progress** | Branch `chore/task-239` — unmerged diff touches `ceo-evidence-contract.ts`, `/api/ops/ceo-evidence`, `scripts/ceo-evidence-summary.sh`, executive dashboard freshness display |
| **Competing PR** | #216 (maturity migrate / KPI / DR) is **related but broader** — RLS probes, north-star contracts, rate-limit degraded mode; **not** a substitute for outcome access semantics |

**Close-first actions (reliability track):**

1. Finish Part 1 on `chore/task-239` — distinguish `unauthorized` / `unavailable` / `stale` / `zero_activity` in contract + dashboard (tests exist in `ceo-evidence-contract.test.ts`).
2. Verify operator can fetch evidence **without** exposing `CTO_OUTCOME_SECRET` to client bundles.
3. Production verify: `GET /api/ops/ceo-evidence` (authenticated) returns fresh denominators; CEO dashboard never renders null access as `0` bookings.
4. Update `OUTCOME_LOG.md` status wording after live verify — mark old "MEASURED = complete" claim superseded.
5. **Then** consider rebasing #216 — maturity KPI gates depend on trustworthy outcome baseline.

**Explicitly defer:** #211 Founder Decision Queue (FD-1…FD-6) — governance, not immediate reliability unblock. #219 draft LINE cron — ops enhancement, lower loss avoidance than outcome truth.

---

## Pick 2 — Highest-value user-facing item

### **PR #200 — Booking fetch timeout (15s AbortController)**

| Field | Detail |
|-------|--------|
| **PR** | [#200 fix(ux): add 15s fetch timeout to all booking data fetches](https://github.com/jerry200176-png/sunrise-cafe/pull/200) |
| **Why highest user value** | Guest booking is core revenue path (CTO_STRATEGY: Discover + Book = A−); hung fetches strand users mid-wizard with no recovery — direct abandonment risk |
| **Scope** | `fetch-with-timeout.ts`; `/book`, `/book/query`, waitlist pages, `PaymentModal` |
| **CI** | Lint & Build ✅ · Playwright smoke ✅ (last run 2026-07-14) |
| **Blocker** | **`mergeable: CONFLICTING`** · `mergeStateStatus: DIRTY` · branch `cubelv-cli-6a549448-booking-fetch-timeout` vs `main` |
| **Vercel** | One preview context FAILURE = **Hobby build rate limit**, not code failure |

**Close-first actions (product track — do not open duplicate implementation):**

1. **Rebase** #200 onto current `main` (conflicts expected in `book/page.tsx`, query, waitlist, payment modal).
2. **Resolve conflicts** preserving both CustomerShell/booking-draft work on main and timeout wrapper from PR.
3. Re-run CI + Playwright booking smoke.
4. Manual verify: throttle network → user sees Chinese timeout error + existing retry controls (`availabilityRetry`, slot retry buttons on `/book`).
5. **Merge** after reliability pick does not block deploy window (timeout change is low regression risk; no schema).
6. Post-merge production spot-check on `/book` slot step.

**Why not other open PRs for user-facing slot:**

| PR | Verdict |
|----|---------|
| #235 / #218 dependabot | Dependency churn — not user journey |
| #219 draft LINE cron verify | Operator ops — valuable but not guest-facing |
| #216 maturity | Infra / admin gates — user impact indirect |

---

## Portfolio hygiene (Sunrise)

| Action | Target |
|--------|--------|
| Keep open | #239 (Phase 2 umbrella), #211 (Founder decisions — no code duplicate) |
| Close-first repair | **#200** (conflicts), then merge when verified |
| Monitor | #216 after outcome path lands — resolve conflicts separately |
| Auto-merge policy | Dependabot #235/#218 — low priority; batch after active tracks |

---

## CEO `github_portfolio` slice (Sunrise-only)

```json
{
  "open_p0": 0,
  "open_p1": 0,
  "stale_prs": 0,
  "blocked_prs": 1,
  "merged_unverified": 0,
  "duplicate_issues": 0,
  "recurring_bug_families": 0,
  "active_reliability_item": "live outcome operator path (#239 Part 1, chore/task-239)",
  "active_product_item": "PR #200 booking fetch timeout (conflict repair)",
  "close_first": ["rebase+merge #200", "ship outcome access on chore/task-239"]
}
```

`blocked_prs: 1` = #200 conflicting; #216 also conflicting but secondary to active picks.

---

*Phase 2 Task B · GitHub portfolio picks · docs-only*
