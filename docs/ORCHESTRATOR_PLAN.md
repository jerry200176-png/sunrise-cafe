# Orchestrator Plan (auto-generated)

**Iteration:** iter-013  
**Generated:** 2026-07-11 13:58 CST  
**main:** `ff3cf47`  
**Policy:** [`ORCHESTRATOR.md`](./ORCHESTRATOR.md)

> Regenerate: `npm run cto:orchestrator`  
> Complete iteration: `npm run cto:orchestrator -- complete <task_id> "<outcome>"`

---

## Signals (discover)

| Signal | Value |
|--------|------:|
| Gate | **BLOCK** (exit 2) |
| Overall health | 60 |
| GitHub score | 47 |
| Doc drift (fail/warn) | 0 / 1 |
| Production SHA match | 0 (`f083d10` vs `ff3cf47`) |
| Bot can close GitHub | 0 |

---

## Selected task

| Field | Value |
|-------|-------|
| **ID** | `doc-drift-fix` |
| **Title** | Fix documentation drift (IMPLEMENTATION_TRUTH, inbox, stale refs) |
| **Role** | [documenter](../orchestrator/roles/documenter.md) |
| **Owner** | agent |
| **Score** | 105 |
| **Evidence** | cto-doc-drift.sh warnings |

### Execution checklist

1. Read role playbook: `orchestrator/roles/documenter.md`
2. Answer Work Gate: [`CTO_WORK_GATE.md`](./CTO_WORK_GATE.md)
3. Implement / execute task (1 MDU if code)
4. `npm test` + `npm run cto:orchestrator -- verify`
5. Commit, PR, merge, verify production SHA
6. `npm run cto:orchestrator -- complete doc-drift-fix "<measurable outcome>"`
7. Re-run `npm run cto:orchestrator` for next task

### Verification

DOC_DRIFT_WARNINGS=0 or documented founder-blocked

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

