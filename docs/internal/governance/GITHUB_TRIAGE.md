# GitHub Triage Registry

**Updated:** 2026-07-13 06:50 CST  
**Gate:** PASS (doc drift sync)

Curated issue/PR actions. See live state: `bash scripts/cto-github-hygiene.sh`

---

## Issues (open: 1)

| # | Title | Action |
|--:|-------|--------|
| 99 | Integrated deposit capture (Stripe/LINE Pay) | **KEEP** — strategic; implement after KPI evidence |

All other former open issues (#53 #54 #61 #63 #95) are **closed on GitHub** — see [`GITHUB_ISSUE_STATUS.md`](./GITHUB_ISSUE_STATUS.md).

---

## Pull requests

**Open:** 0 (as of 2026-07-13 after #177 #178 merge)

Recent merged:

| # | Title |
|--:|-------|
| 178 | LINE Flex cards unified |
| 177 | AI-company orchestrator patterns |
| 176 | 15 QA UX/a11y fixes |

---

## Branches

After merge: delete stale `cursor/*` on remote. Target: `main` + at most 1 active agent branch.

```bash
# Example cleanup (merged branches only)
git push origin --delete cursor/gmail-secret-fallback-d275
git push origin --delete cursor/gmail-secrets-guide-bb51
```

---

## Hygiene command

```bash
bash scripts/cto-github-hygiene.sh
npm run cto:governance
```

Bot **cannot** close issues — agent merges PRs via PR tool; Founder only for secrets/migrations.
