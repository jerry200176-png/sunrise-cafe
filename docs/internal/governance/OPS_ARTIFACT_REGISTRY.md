# Ops Artifact Registry — Operational Governance

**CTO OS v2 · Company-first**  
**Purpose:** Every operational artifact has **owner · cadence · success metric · retirement criteria**.

> Artifacts improve **capability**. Only [`OUTCOME_LOG.md`](./OUTCOME_LOG.md) proves **business outcomes**.

---

## Registry

| ID | Artifact | Type | Owner | Review cadence | Success metric | Retirement criteria |
|----|----------|------|-------|----------------|----------------|---------------------|
| ART-001 | [`OPS_MIGRATION_RUNBOOK.md`](./OPS_MIGRATION_RUNBOOK.md) | Runbook | Ops / Founder | Once until done | 3 migrations in `schema_migrations` | **Retire** when all 3 applied + verified 30 days |
| ART-002 | [`OPS_WEEKLY_BUSINESS_REVIEW.md`](./OPS_WEEKLY_BUSINESS_REVIEW.md) | Ritual | Founder / 店長 | Weekly Mon 10:00 | `OUTCOME_LOG` updated 4 consecutive weeks | **Retire** when KPIs automated in admin AND deposit_rate stable ≥85% for 8 weeks |
| ART-003 | [`OPS_PAYMENT_SOP.md`](./OPS_PAYMENT_SOP.md) | SOP | 店長 | Daily open/close + monthly audit | deposit_rate ≥85% for 4 weeks OR pending_reviews avg <2 | **Retire** when replaced by paid gateway + auto-reconcile |
| ART-004 | [`EXECUTIVE_INBOX.md`](./EXECUTIVE_INBOX.md) | Governance | CTO Agent | Every iteration | Inbox reviewed before work selection | Never — compress if signals <3 active |
| ART-005 | [`OUTCOME_LOG.md`](./OUTCOME_LOG.md) | Evidence | Founder | Weekly with ART-002 | ≥1 outcome metric non-null per week | **Merge into** admin dashboard when automated |
| ART-006 | [`DECISION_LOG.md`](./DECISION_LOG.md) | Governance | CTO Agent | Per prioritization change | Every rank change has DL entry | Archive yearly to `docs/archive/` |
| ART-007 | [`ENGINEERING_GOVERNANCE.md`](./ENGINEERING_GOVERNANCE.md) | Governance | CTO Agent | Before feature MDU + weekly CI | `cto:governance` exit 0 | Never — policy SSOT |
| ART-008 | [`GOVERNANCE_STATUS.md`](./GOVERNANCE_STATUS.md) | Report | CTO Agent | Each `cto:governance` run | Timestamp + gate verdict current | Regenerated each run |
| ART-009 | [`GITHUB_TRIAGE.md`](./GITHUB_TRIAGE.md) | Registry | CTO Agent | Each governance run | Open items have CLOSE/KEEP/DEFER | Empty when backlog clean |
| ART-010 | [`FOUNDER_ACTION_LIST.md`](./FOUNDER_ACTION_LIST.md) | Escalation | Founder | When bot blocked | All P0 blockers have copy-paste cmds | **Retire** when list empty 4 weeks |
| ART-011 | [`ORCHESTRATOR.md`](./ORCHESTRATOR.md) | Platform | CTO Agent | Every iteration start | `cto:orchestrator` selects next task | Never — OS SSOT |
| ART-012 | [`orchestrator/state.json`](../orchestrator/state.json) | State | CTO Agent | Each plan/complete | Recoverable after interrupt | Regenerated each complete |
| ART-013 | [`ORCHESTRATOR_LOG.md`](./ORCHESTRATOR_LOG.md) | Audit | CTO Agent | Each `complete` | Append-only iteration row | Archive yearly |

---

## Capability vs Outcome

| | Capability | Outcome |
|--|------------|---------|
| **Definition** | We *can* do something | Business *improved* measurably |
| **Examples** | SOP exists, cron code, RBAC | 訂金率 78%→86%, 客訴 -50% |
| **Health score** | Technical checklist | `OUTCOME_LOG` evidence only |
| **Round 8 mistake** | +15 revenue for doc existence | ❌ **Reverted Round 9** |

---

## Artifact lifecycle

```
Create → Active → (measure outcomes) → Retire OR Automate
```

**Stop rule:** If artifact active **>8 weeks** with **no outcome improvement** in `OUTCOME_LOG` → Decision Log entry to **retire or redesign** artifact.

---

## Round 9 audit

| Artifact | Active since | Outcomes logged? | Verdict |
|----------|--------------|------------------|---------|
| ART-001 | Round 8 | No | Keep — Ops must execute |
| ART-002 | Round 8 | No | Keep — first review pending |
| ART-003 | Round 8 | No | Keep — daily use not started |
| Health +15 for docs | Round 8 | N/A | **STOP — reverted** |

---

*DL-013 · Do not score documentation as business health.*
