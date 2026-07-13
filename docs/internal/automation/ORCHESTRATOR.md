# AI Engineering Orchestrator

**Owner:** CTO Agent · **SSOT for:** autonomous engineering operations  
**Version:** 1.0 · 2026-07-11  
**Supersedes:** manual iteration planning; **extends** [`ENGINEERING_GOVERNANCE.md`](./ENGINEERING_GOVERNANCE.md)

> The orchestrator is the **long-term operating system** for engineering work — discover, prioritize, execute, verify, document, repeat.

---

## 1. Mission

Continuously run the engineering loop without waiting for new instructions:

```
Discover → Prioritize → Plan → Execute → Verify → Record → (next task)
```

GitHub is the **engineering OS** (issues, PRs, branches, labels). Documentation is a **production asset**. Every iteration must leave the repository measurably better.

---

## 2. Architecture

```
orchestrator/
  state.json           # Recoverable state (iteration count, blockers, last task)
  task-catalog.json    # Scored work queue (extensible)
  discover.env         # Latest signals (generated)
  priority.json        # Ranked tasks (generated)
  roles/               # Role playbooks (modular agents)

scripts/orchestrator/
  discover.sh          # Signals: gate, health, GitHub, drift, outcomes
  prioritize.sh        # Score catalog → select next_task
  plan.sh              # Write ORCHESTRATOR_PLAN.md
  verify.sh            # Post-iteration checks
  record.sh            # Append ORCHESTRATOR_LOG + update state

scripts/cto-orchestrator.sh   # Main entry
```

### Role coordination (single agent today → multi-agent later)

| Role | Playbook | Activates when |
|------|----------|----------------|
| **Governor** | [`roles/governor.md`](../orchestrator/roles/governor.md) | Gate BLOCK, GitHub hygiene |
| **Planner** | [`roles/planner.md`](../orchestrator/roles/planner.md) | Task selection, capability gaps |
| **Implementer** | [`roles/implementer.md`](../orchestrator/roles/implementer.md) | Code MDU on `main` |
| **Reviewer** | [`roles/reviewer.md`](../orchestrator/roles/reviewer.md) | Pre-merge Work Gate |
| **Operator** | [`roles/operator.md`](../orchestrator/roles/operator.md) | Migrations, deploy, KPIs |
| **Documenter** | [`roles/documenter.md`](../orchestrator/roles/documenter.md) | Drift, SSOT sync |
| **Security** | [`roles/security.md`](../orchestrator/roles/security.md) | CVE, RBAC, audit |
| **Product analyst** | [`roles/product-analyst.md`](../orchestrator/roles/product-analyst.md) | Staff/guest friction |

Each role defines **inputs, outputs, stop rules** — future agents attach to the same contracts.

---

## 3. Commands

| Command | Action |
|---------|--------|
| `npm run cto:orchestrator` | Full cycle: discover → prioritize → plan |
| `npm run cto:orchestrator -- verify` | Post-iteration verification |
| `npm run cto:orchestrator -- complete <id> "outcome" [pr]` | Record iteration |
| `npm run cto:loop` | **Autonomous iteration** (handler → validate → PR) |
| `npm run cto:loop:canary` | Forced canary with evidence artifact |
| `npm run cto:deploy-gate` | LIVE vs STANDBY (prod SHA = main) |
| `npm run cto:governance` | Health gate (sub-module, governor role) |

**Unattended loop:** [`.github/workflows/autonomous-loop.yml`](../.github/workflows/autonomous-loop.yml) — see [`AUTONOMY_AUDIT.md`](./AUTONOMY_AUDIT.md)

**Agent start ritual (interactive fallback):**

1. `npm run cto:orchestrator`
2. Read [`ORCHESTRATOR_PLAN.md`](./ORCHESTRATOR_PLAN.md)
3. Execute selected task (1 MDU)
4. `npm run cto:orchestrator -- verify`
5. PR → merge → `complete` → re-run orchestrator

---

## 4. Prioritization engine

Tasks live in [`orchestrator/task-catalog.json`](../orchestrator/task-catalog.json).

**Scoring rules:**

| Factor | Effect |
|--------|--------|
| `base_score` | Intrinsic impact |
| `gate_block_bonus` | Extra weight when governance gate BLOCK |
| `requires_gate_pass` | Feature tasks deferred until gate PASS |
| `owner: founder` | Not agent-executable — listed as blocked |
| `independent: true` | Runnable while Founder blockers exist |
| Repeat penalty | Avoid same task twice in a row |

**Stop autonomous execution only when:**

- Founder permission/credentials required
- Irreversible action needs approval
- External outage blocks verify/deploy
- `next_task` is `idle` (no executable work)

**When blocked:** execute highest-value **independent** task (doc drift, orchestrator, branch cleanup).

---

## 5. Knowledge base (long-term memory)

| Layer | SSOT | Updated by |
|-------|------|------------|
| Code truth | `IMPLEMENTATION_TRUTH.md` | Each merged MDU |
| Business signals | `EXECUTIVE_INBOX.md` | Each iteration |
| Decisions | `DECISION_LOG.md` | Priority changes |
| Capability gaps | `CAPABILITY_GAPS.md` | Quarterly + each plan |
| Iteration history | `ORCHESTRATOR_LOG.md` | `complete` command |
| Blockers | `FOUNDER_ACTION_LIST.md` | Governance run |
| Architecture | `ARCHITECTURE.md`, `CLAUDE.md` | On structural change |

---

## 6. Observability & recovery

| Artifact | Purpose |
|----------|---------|
| `orchestrator/state.json` | Resume after interruption |
| `orchestrator/discover.env` | Last signal snapshot |
| `docs/ORCHESTRATOR_PLAN.md` | Current iteration instructions |
| `docs/ORCHESTRATOR_LOG.md` | Append-only audit trail |
| CI `orchestrator.yml` | Daily heartbeat + plan artifact |

After any interruption: `npm run cto:orchestrator` regenerates plan from live signals.

---

## 7. Industry comparison (evidence-based only)

See [`CAPABILITY_GAPS.md`](./CAPABILITY_GAPS.md). Adopt practices from Stripe, Vercel, Linear, etc. **only** when:

- Verified friction in this repo or production
- Fits Taiwan SMB + LINE deposit model
- Measurable outcome or capability improvement

---

## 8. Related artifacts

| ID | Artifact |
|----|----------|
| ART-011 | This document |
| ART-012 | `orchestrator/state.json` |
| ART-013 | `ORCHESTRATOR_LOG.md` |

Registry: [`OPS_ARTIFACT_REGISTRY.md`](./OPS_ARTIFACT_REGISTRY.md)

---

*The orchestrator never pauses for routine decisions. It selects the next highest-impact task from evidence and executes.*
