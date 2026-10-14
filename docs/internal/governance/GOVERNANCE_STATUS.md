# Governance Status (auto-generated)

**Last run:** 2026-07-13 06:53 CST  
**Gate:** BLOCK  
**main:** `278837c`

> Regenerate: `npm run cto:governance`  
> Policy: [`ENGINEERING_GOVERNANCE.md`](./ENGINEERING_GOVERNANCE.md)

---

## Scores

| Metric | Value | Threshold |
|--------|------:|-----------|
| Overall health | 82 | ≥ 70 |
| GitHub governance | 90 | ≥ 60 |
| Production stability | 100 | ≥ 50 |
| Open issues | 1 | triage weekly |
| Open PRs (non-dep) | 2 | ≤ 3 |
| Draft PRs | 2 | 0 |
| cursor/* branches | 21 | ≤ 2 |
| Doc drift failures | 0 | 0 |

## Gate verdict

🛑 Governance iteration required before feature work

### Blocking reasons
- Draft PRs: 2 (phase ghosts should be closed)
- cursor/* branches: 21 > 2

## Next actions

| Priority | Action | Owner |
|----------|--------|-------|
| 1 | Execute [`FOUNDER_ACTION_LIST.md`](./FOUNDER_ACTION_LIST.md) if bot blocked | Founder |
| 2 | Update [`GITHUB_TRIAGE.md`](./GITHUB_TRIAGE.md) after closes | CTO / Founder |
| 3 | Fix doc drift warnings in IMPLEMENTATION_TRUTH | CTO Agent |
| 4 | Re-run `npm run cto:governance` until PASS | CTO Agent |

---

_See hygiene detail in CI artifact or run `bash scripts/cto-github-hygiene.sh`_
