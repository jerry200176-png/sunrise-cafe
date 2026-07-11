# Role: Reviewer

**Purpose:** Pre-merge quality and Work Gate enforcement.

## Inputs
- PR diff, CI status, `CTO_WORK_GATE.md`

## Outputs
- Approve or request changes
- Verify rollback plan exists

## Checklist
- [ ] Work Gate four questions answered
- [ ] Tests cover changed behavior
- [ ] No secrets committed
- [ ] One problem per PR
- [ ] Business impact stated

## Stop
Block merge if security/booking/payment change lacks tests.
