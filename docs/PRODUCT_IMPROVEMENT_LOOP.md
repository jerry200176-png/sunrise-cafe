# Product Improvement Loop (Permanent)

**Mode:** Continuous Product Improvement — every PR must improve the product, not just ship code.

## Loop

```
Hypothesis → Baseline → Implement → Measure → Compare → Iterate
```

| Phase | Question | Artifact |
|-------|----------|----------|
| **Hypothesis** | What problem, why will this fix it, expected Δ? | PR body + [`HYPOTHESES.md`](./HYPOTHESES.md) |
| **Baseline** | What is Observed today? | [`NORTH_STAR_METRICS.md`](./NORTH_STAR_METRICS.md) + [`IMPROVEMENT_LOG.md`](./IMPROVEMENT_LOG.md) |
| **Implement** | Smallest PR that targets one metric | Code + CI |
| **Measure** | What changed after deploy? | `/admin/executive` · `GET /api/admin/north-star` · ops-log |
| **Compare** | Met target? Δ vs baseline? | `IMPROVEMENT_LOG.md` + weekly review |
| **Iterate** | Adjust, simplify, merge, remove, or rollback? | Backlog re-rank · stop-invest list |

**A feature is NOT done until Compare is recorded** (or marked `pending_deploy` with Founder blocker).

---

## 1. Hypothesis required before implementation

**No Hypothesis → no code.**

Every PR must document:

| Field | Question |
|-------|----------|
| Problem | What is broken or causing friction? |
| Mechanism | Why will this change improve it? |
| North Star metrics | Which KPIs should move? |
| Expected magnitude | How much? (e.g. +5pp deposit_conversion) |
| Verify window | T+7 / T+14 / T+30 |
| If wrong | Adjust, rollback, or redesign plan |

Template: [`HYPOTHESES.md`](./HYPOTHESES.md)

---

## 2. Observed vs Target (not targets alone)

Every North Star metric maintains:

| Field | Description |
|-------|-------------|
| **Observed** | Current real data |
| **Target** | Goal with documented rationale |
| **Delta** | Gap (positive = toward target) |
| **Trend** | 7 / 30 / 90 day (weekly snapshots) |
| **Data Source** | Pipeline, ops-log, RUM, etc. |
| **Last Updated** | ISO timestamp |

Live: `GET /api/admin/north-star` · [`NORTH_STAR_METRICS.md`](./NORTH_STAR_METRICS.md)

**Targets must cite rationale** — see `src/lib/north-star-targets.ts`. Arbitrary targets are not allowed.

---

## 3. Features are not assets — only effective features are

After Compare, if evidence shows:

- No metric improvement
- No usage
- Maintenance cost > benefit
- Negative or neutral North Star impact

**Proactively propose:** modify · simplify · merge · **remove**

Do not keep features because development finished. Log in Weekly Review § 建議停止投入.

---

## 4. Always hunt highest ROI

Do not blindly follow backlog order. Continuously scan for:

- Biggest **user friction**
- Slowest **staff workflows**
- Most frequent **errors**
- Highest **drop-off** steps
- Best **automation** candidates

Re-rank before every PR. Top 10: [`WEEKLY_EXECUTIVE_REVIEW.md`](./WEEKLY_EXECUTIVE_REVIEW.md) or `GET /api/admin/executive-review`.

---

## 5. Weekly Executive Review

Each week or major iteration, produce a review (do not wait for Founder):

| Section | Content |
|---------|---------|
| 本週交付 | Shipped PRs |
| North Star 變化 | Observed / Target / Δ |
| Hypothesis 證實 | Confirmed |
| Hypothesis 否定 | Rejected + action |
| 建議停止投入 | Features to cut |
| 下一週 Top 10 ROI | Re-ranked backlog |

**Generate:** `npm run executive:review` · `GET /api/admin/executive-review`  
**Archive:** [`WEEKLY_EXECUTIVE_REVIEW.md`](./WEEKLY_EXECUTIVE_REVIEW.md)

---

## Permanent reduction checks

Before building new UI:

- Can this **flow be deleted**?
- Can this step be **automated**?
- Can these **pages merge**?
- Can we **remove a click**?
- Can we **prevent** this human error?

---

## Founder-only blockers

When production deploy is blocked (Vercel rate limit, migrations), mark `pending_deploy` and continue code + CI. Re-measure when production catches up.

Stop only for: Founder-only permissions · business/legal decisions · irreversible production ops.

---

## Related docs

- [`HYPOTHESES.md`](./HYPOTHESES.md) — active hypotheses
- [`NORTH_STAR_METRICS.md`](./NORTH_STAR_METRICS.md) — KPI registry
- [`IMPROVEMENT_LOG.md`](./IMPROVEMENT_LOG.md) — per-delivery compare
- [`WEEKLY_EXECUTIVE_REVIEW.md`](./WEEKLY_EXECUTIVE_REVIEW.md) — weekly archive
- [`ENGINEERING_BACKLOG.md`](./ENGINEERING_BACKLOG.md) — ROI queue
- [`OUTCOME_LOG.md`](./OUTCOME_LOG.md) — business evidence
