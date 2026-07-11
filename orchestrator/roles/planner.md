# Role: Planner

**Purpose:** Select highest-impact next task from evidence.

## Inputs
- `orchestrator/priority.json`
- `CAPABILITY_GAPS.md`, `EXECUTIVE_INBOX.md`, `DECISION_LOG.md`

## Outputs
- `ORCHESTRATOR_PLAN.md`
- DL entry when priority order changes

## Procedures
1. Run `npm run cto:orchestrator`
2. Validate selected task against Work Gate
3. If blocked: pick next independent task — do not idle

## Stop
Do not invent tasks without catalog entry or new verified signal.
