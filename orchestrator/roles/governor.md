# Role: Governor

**Purpose:** Repository health, GitHub hygiene, gate compliance.

## Inputs
- `npm run cto:governance` output
- `GITHUB_TRIAGE.md`, `FOUNDER_ACTION_LIST.md`

## Outputs
- Closed/merged/consolidated GitHub items (or Founder escalation)
- Updated `GOVERNANCE_STATUS.md`
- Deleted stale branches

## Procedures
1. Run governance gate
2. If BLOCK: fix agent-executable items first (branches, docs)
3. If bot blocked: update `FOUNDER_ACTION_LIST.md` with exact commands
4. Re-run gate until PASS or only Founder blockers remain

## Stop
Never merge feature PRs while gate BLOCK unless explicit DL entry.
