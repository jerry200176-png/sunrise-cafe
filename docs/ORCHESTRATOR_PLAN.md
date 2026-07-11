# Orchestrator Plan (auto-generated)

**Iteration:** iter-014  
**Generated:** 2026-07-11 15:14 CST  
**main:** `886a36c`  
**Policy:** [`ORCHESTRATOR.md`](./ORCHESTRATOR.md)

> Regenerate: `npm run cto:orchestrator`  
> Complete iteration: `npm run cto:orchestrator -- complete <task_id> "<outcome>"`

---

## Signals (discover)

| Signal | Value |
|--------|------:|
| Gate | **BLOCK** (exit 2) |
| Overall health | 55 |
| GitHub score | 42 |
| Doc drift (fail/warn) | 0 / 2 |
| Production SHA match | 0 (`f083d10` vs `886a36c`) |
| Bot can close GitHub | 1 |

---

## Selected task

| Field | Value |
|-------|-------|
| **ID** | `doc-drift-fix` |
| **Title** | Fix documentation drift (IMPLEMENTATION_TRUTH, inbox, stale refs) |
| **Role** | [documenter](../orchestrator/roles/documenter.md) |
| **Owner** | agent |
| **Score** | 110 |
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

