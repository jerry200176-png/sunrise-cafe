# GitHub Triage Registry

**Updated:** 2026-07-13 15:25 CST  
**Gate:** PASS (Round 27 boss execution)

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
| 181 | OPS-004b funnel metrics on Executive dashboard |
| 180 | Deploy verify + LINE validation SOP (Round 26) |
| 179 | GitHub/doc cleanup |
| 178 | LINE Flex cards unified |
| 177 | AI-company orchestrator patterns |

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
