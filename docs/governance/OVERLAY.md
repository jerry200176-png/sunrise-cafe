# sunrise-cafe governance overlay

Rules: `governance/RULEBOOK.md` (vendored, version and source commit pinned in `governance/RULEBOOK.lock`).
`npm run gov:overlay-pin` runs `python3 scripts/check-rulebook.py` (offline pin, adapter and retired-phrase check).

This repo keeps product operating docs under [`docs/internal/governance/`](../internal/governance/); they are
historical snapshots (see their header line). Product-specific pointers:

| Topic | Path |
|-------|------|
| Deploy / SHA | `docs/DEPLOYMENT.md`, `.github/workflows/verify-production.yml` |
| LINE / Cron | `docs/LINE.md`, `AGENTS.md`, `docs/AI_DOMAIN_NOTES.md` |
| Payments | `docs/OPS_PAYMENT_SOP.md`, `docs/PAYMENT_STATE_MODEL.md` |

`autonomous-loop.yml` is **disabled** after a self-dispatch CI storm (capability probe used `gh workflow run`). Re-enable only with a non-dispatching probe (rulebook B9).
