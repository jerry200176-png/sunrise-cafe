# Product Improvement Loop (Permanent)

**Mode:** Continuous Product Improvement — every PR must improve the product, not just ship code.

## Loop

```
Baseline → Implement → Measure → Compare → Iterate
```

| Phase | Question | Artifact |
|-------|----------|----------|
| **Baseline** | What is the metric today? | `docs/NORTH_STAR_METRICS.md` + `docs/IMPROVEMENT_LOG.md` |
| **Implement** | Smallest PR that targets one metric | PR with value assessment |
| **Measure** | What changed after deploy? | `/admin/executive` · `GET /api/admin/north-star` · Vercel ops-log |
| **Compare** | Did we hit target? Δ vs baseline? | `IMPROVEMENT_LOG.md` entry |
| **Iterate** | Adjust, double down, or rollback? | Backlog re-rank in `ENGINEERING_BACKLOG.md` |

**A feature is NOT done until Compare is recorded** (or marked `pending_deploy` with Founder blocker).

## Every PR must answer

1. Which North Star metric(s) does this target?
2. Baseline value (from pipeline or `unmeasured`)
3. Expected Δ after deploy
4. How we will measure (data source)
5. Rollback trigger (what metric worsens → revert)

## Permanent reduction checks

Before building new UI, ask:

- Can this **flow be deleted**?
- Can this step be **automated**?
- Can these **pages merge**?
- Can we **remove a click**?
- Can we **prevent** this human error?

Log findings in PR body or `IMPROVEMENT_LOG.md` § Process debt.

## Founder-only blockers

When production deploy is blocked (Vercel rate limit, migrations), mark improvement entries `pending_deploy` and continue code + CI work. Re-measure when production catches up.

## Related docs

- [`NORTH_STAR_METRICS.md`](./NORTH_STAR_METRICS.md) — metric definitions & live values
- [`IMPROVEMENT_LOG.md`](./IMPROVEMENT_LOG.md) — per-delivery before/after
- [`ENGINEERING_BACKLOG.md`](./ENGINEERING_BACKLOG.md) — ROI-ranked queue
- [`OUTCOME_LOG.md`](./OUTCOME_LOG.md) — weekly business evidence
