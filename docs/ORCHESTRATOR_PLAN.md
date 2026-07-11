# Orchestrator Plan (auto-generated)

**Iteration:** iter-011  
**Generated:** 2026-07-11 13:44 CST  
**main:** `488788b`  
**Policy:** [`ORCHESTRATOR.md`](./ORCHESTRATOR.md)

> Regenerate: `npm run cto:orchestrator`  
> Complete iteration: `npm run cto:orchestrator -- complete <task_id> "<outcome>"`

---

## Signals (discover)

| Signal | Value |
|--------|------:|
| Gate | **BLOCK** (exit 2) |
| Overall health | 68 |
| GitHub score | 47 |
| Doc drift (fail/warn) | 0 / 0 |
| Production SHA match | 1 (`488788b` vs `488788b`) |
| Bot can close GitHub | 0 |

---

## Selected task

| Field | Value |
|-------|-------|
| **ID** | `orch-os-evolve` |
| **Title** | Evolve AI Engineering Orchestrator (discover/prioritize/plan/verify) |
| **Role** | [implementer](../orchestrator/roles/implementer.md) |
| **Owner** | agent |
| **Score** | 120 |
| **Evidence** | docs/ORCHESTRATOR.md |

### Execution checklist

1. Read role playbook: `orchestrator/roles/implementer.md`
2. Answer Work Gate: [`CTO_WORK_GATE.md`](./CTO_WORK_GATE.md)
3. Implement / execute task (1 MDU if code)
4. `npm test` + `npm run cto:orchestrator -- verify`
5. Commit, PR, merge, verify production SHA
6. `npm run cto:orchestrator -- complete orch-os-evolve "<measurable outcome>"`
7. Re-run `npm run cto:orchestrator` for next task

### Verification

npm run cto:orchestrator produces ORCHESTRATOR_PLAN.md

---

## Blocked high-value work (Founder / gate)

| Task | Owner | Reason | Score |
|------|-------|--------|------:|
| — | — | none | 0 |

See [`FOUNDER_ACTION_LIST.md`](./FOUNDER_ACTION_LIST.md).

---

## Stop conditions

Stop autonomous execution only when:

- Founder-only permission required (document in FOUNDER_ACTION_LIST)
- Irreversible/destructive action needs approval
- External outage blocks deploy/verify
- No executable tasks remain (`next_task: idle`)

Otherwise: continue to next iteration.

