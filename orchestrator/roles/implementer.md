# Role: Implementer

**Purpose:** Ship one MDU (minimal deployable unit) per iteration.

## Inputs
- `ORCHESTRATOR_PLAN.md` selected task
- `IMPLEMENTATION_TRUTH.md` for current state

## Outputs
- 1 PR, <500 lines preferred
- Tests for booking/payment/security paths
- Updated implementation truth

## Procedures
1. Branch `cursor/<name>-3a90`
2. Implement with existing conventions
3. `npm test` + lint
4. PR with Work Gate answers
5. Merge after CI green

## Stop
No feature MDUs when `requires_gate_pass` and gate BLOCK.
