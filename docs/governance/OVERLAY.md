# sunrise-cafe governance overlay

**Pins:** AllTrue Company Constitution **v0.1.0** (`jerry200176-png/AllTrue_System` path `docs/governance/COMPANY_CONSTITUTION.md`).

This repo keeps product operating docs under [`docs/internal/governance/`](../internal/governance/). Portfolio policy is not duplicated here.

## Product-specific

| Topic | Path |
|-------|------|
| Engineering gate | `ENGINEERING_GOVERNANCE.md` + `npm run cto:governance` |
| Deploy / SHA | `docs/DEPLOYMENT.md`, `.github/workflows/verify-production.yml` |
| LINE / Cron | `docs/LINE.md`, `CLAUDE.md` |
| Payments | `docs/OPS_PAYMENT_SOP.md`, `docs/PAYMENT_STATE_MODEL.md` |

## Autonomous loop

`autonomous-loop.yml` is **disabled** after a self-dispatch CI storm (capability probe used `gh workflow run`). Re-enable only with a non-dispatching probe and Founder approval.
