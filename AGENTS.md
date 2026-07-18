# AGENTS.md — sunrise-cafe entry (tool-neutral)

Portfolio Constitution (canonical): pin via [`docs/governance/OVERLAY.md`](docs/governance/OVERLAY.md) → AllTrue `docs/governance/COMPANY_CONSTITUTION.md`.

## First-read

1. This file + [`docs/governance/OVERLAY.md`](docs/governance/OVERLAY.md)
2. [`CLAUDE.md`](CLAUDE.md) (product adapter)
3. [`docs/internal/governance/ENGINEERING_GOVERNANCE.md`](docs/internal/governance/ENGINEERING_GOVERNANCE.md)
4. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) / [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
5. `npm run cto:governance` when hygiene is in scope

## Hard rules

- Do **not** mix changes with AllTrue System in one PR.
- Do **not** re-enable `.github/workflows/autonomous-loop.yml` without fixing capability probes (self-`gh workflow run` caused cancel storms; workflow is **disabled_manually** as of 2026-07-18).
- Production verify: `verify-production.yml` / `GET /api/version` SHA match.
- Prefer Evidence over governance score green alone (`GOVERNANCE_STATUS.md` can be stale).
