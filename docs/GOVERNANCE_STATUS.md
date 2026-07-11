# Governance Status (auto-generated)

**Last run:** 2026-07-11 13:51 CST  
**Gate:** BLOCK  
**main:** `f083d10`

> Regenerate: `npm run cto:governance`  
> Policy: [`ENGINEERING_GOVERNANCE.md`](./ENGINEERING_GOVERNANCE.md)

---

## Scores

| Metric | Value | Threshold |
|--------|------:|-----------|
| Overall health | 60 | ≥ 70 |
| GitHub governance | 47 | ≥ 60 |
| Production stability | 42 | ≥ 50 |
| Open issues | 9 | triage weekly |
| Open PRs (non-dep) | 9 | ≤ 3 |
| Draft PRs | 8 | 0 |
| cursor/* branches | 0 | ≤ 2 |
| Doc drift failures | 0 | 0 |

## Gate verdict

🛑 Governance iteration required before feature work

### Blocking reasons
- Overall health 60 < 70
- GitHub governance 47 < 60
- Production stability 42 < 50
- Non-dependabot open PRs: 9 > 3
- Draft PRs: 8 (phase ghosts should be closed)

## Next actions

| Priority | Action | Owner |
|----------|--------|-------|
| 1 | Execute [`FOUNDER_ACTION_LIST.md`](./FOUNDER_ACTION_LIST.md) if bot blocked | Founder |
| 2 | Update [`GITHUB_TRIAGE.md`](./GITHUB_TRIAGE.md) after closes | CTO / Founder |
| 3 | Fix doc drift warnings in IMPLEMENTATION_TRUTH | CTO Agent |
| 4 | Re-run `npm run cto:governance` until PASS | CTO Agent |

---

_See hygiene detail in CI artifact or run `bash scripts/cto-github-hygiene.sh`_
