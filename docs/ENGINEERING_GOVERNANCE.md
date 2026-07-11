# Engineering Governance — Repository Operating System

**Owner:** CTO Agent · **SSOT for:** when to ship features vs run governance  
**Supersedes:** iteration-count planning; complements [`CTO_OS_V2.md`](./CTO_OS_V2.md)  
**Updated:** 2026-07-11

> GitHub is the **engineering operating system** — not a task tracker.  
> Governance runs on **objective repository signals**, not round numbers.

---

## 1. Principles

| Principle | Meaning |
|-----------|---------|
| **Repository-driven** | Health, drift, and hygiene signals trigger work — not calendar rounds |
| **Evidence over appearance** | No governance docs without measurable effect |
| **Gate before features** | When health is below standard, governance iteration **blocks** new feature MDUs |
| **Minimal Founder surface** | Bot documents exact permission blockers; Founder gets copy-paste actions |
| **Company-first** | Outcome scores from [`OUTCOME_LOG.md`](./OUTCOME_LOG.md) only ([`HEALTH_SCORES.md`](./HEALTH_SCORES.md)) |

---

## 2. Objective health signals

Collected by `npm run cto:governance` (aggregates `cto:health`, GitHub hygiene, doc drift).

| Signal | Source | Governance trigger |
|--------|--------|-------------------|
| Overall health | `cto:health` weighted score | **< 70** |
| GitHub governance | open PRs, drafts, stale branches | **< 60** |
| Production stability | SHA parity, booking-health | **< 50** |
| Open non-dependabot PRs | `gh pr list` | **> 3** |
| Draft / phase PRs | `gh pr list` | **> 0** |
| Doc drift failures | `cto-doc-drift.sh` | **≥ 1 critical** |
| Migration drift | `npm run verify:migrations` | **fail** |
| Outcome stale | `OUTCOME_LOG` > 14 days | **warn** (not blocking alone) |

**Healthy enough for feature work:** `cto:governance` exit **0**  
**Governance iteration required:** exit **2**

---

## 3. Governance iteration (when gate fails)

Execute in order — **do not start feature MDUs until gate passes or Founder unblocks P0 ops**.

```
1. npm run cto:governance          → read GOVERNANCE_STATUS.md + FOUNDER_ACTION_LIST.md
2. GitHub hygiene                → close/merge/consolidate (Founder if bot blocked)
3. Doc drift fixes               → IMPLEMENTATION_TRUTH, stale issue refs
4. Delete merged remote branches → script section in cto-github-hygiene
5. Re-run cto:governance         → exit 0 required before features
```

### Measurable outputs (every governance run)

- `docs/GOVERNANCE_STATUS.md` updated (timestamp, scores, gate)
- `docs/FOUNDER_ACTION_LIST.md` updated (only permission-blocked items)
- Stale `cursor/*` branches removed where bot has access
- At least one doc drift fix OR explicit "no drift" in status

---

## 4. GitHub hygiene SOP

### Issues

| Action | When |
|--------|------|
| **Close** | Shipped on `main`, duplicate, or Work Gate = defer |
| **Consolidate** | Multiple issues same root cause → one + links |
| **Relabel** | P0–P3 per [`CTO_WORK_GATE.md`](./CTO_WORK_GATE.md) |
| **Comment** | Close blocked by permissions — link evidence PR/commit |

**Triage registry:** [`docs/GITHUB_TRIAGE.md`](./GITHUB_TRIAGE.md) (curated; updated each governance run)

### Pull requests

| Action | When |
|--------|------|
| **Merge** | CI green, Work Gate answered, one MDU |
| **Close** | Superseded by `main`, draft phase PR, dependabot major |
| **Reject** | No business impact; document in Decision Log |

**Rules:** max **3** open non-dependabot PRs; **0** draft phase PRs; delete head branch within 24h of merge.

### Branches

- Allowed on remote: `main`, `dependabot/*`, **0–2** active `cursor/*`
- Delete merged `cursor/*` after squash merge (GitHub UI or `git push origin --delete`)

### Bot permission limit

If `gh issue close` / `gh pr close` returns `Resource not accessible by integration`:

1. Add exact items to [`FOUNDER_ACTION_LIST.md`](./FOUNDER_ACTION_LIST.md)
2. Do **not** leave repo in ambiguous state — triage doc lists SHAs and reasons

---

## 5. Documentation as production assets

**SSOT hierarchy** (conflict resolution):

1. [`IMPLEMENTATION_TRUTH.md`](./IMPLEMENTATION_TRUTH.md) — deployed code state
2. [`ENGINEERING_GOVERNANCE.md`](./ENGINEERING_GOVERNANCE.md) — this file
3. [`CTO_OS_V2.md`](./CTO_OS_V2.md) — company rhythm
4. Domain docs (PAYMENT_STATE_MODEL, RUNBOOK, ADRs in DECISION_LOG)

**Drift checks** (`scripts/cto-doc-drift.sh`):

- Test count in IMPLEMENTATION_TRUTH vs `npm test`
- Production SHA vs `/api/version`
- Stale "open issue" claims in IMPLEMENTATION_TRUTH / EXECUTIVE_INBOX
- `verify:migrations` pass

**Retire / consolidate:** Phase 4–8 roadmap docs are **frozen** — do not expand; point to Business Impact Queue.

---

## 6. Technical governance dimensions

Reviewed each governance run (not all require action):

| Dimension | Evidence source |
|-----------|-----------------|
| Architecture | IMPLEMENTATION_TRUTH, ADRs |
| Security | npm audit, RBAC routes, recent PRs |
| Testing | CI, test count, E2E coverage row |
| Observability | ops-log, job_runs, Sentry config |
| Operations | OPS_MIGRATION_RUNBOOK, cron job_runs |
| UX / staff friction | Executive inbox signals |
| Cost | Vercel/Supabase free-tier limits in RUNBOOK |

**Industry comparison** (OpenAI, Stripe, Vercel, etc.): use for **capability gap identification** only — adopt changes when evidence fits Taiwan SMB + LINE deposit model ([`#99`](https://github.com/jerry200176-png/sunrise-cafe/issues/99)).

---

## 7. Automation

| Command | Purpose |
|---------|---------|
| `npm run cto:governance` | **Gate + full report** (run before feature work) |
| `npm run cto:health` | Capability + outcome scores |
| `npm run cto:snapshot` | Daily dashboard paste block |
| `npm run cto:outcomes` | Sync KPIs when secrets set |

**CI:** [`.github/workflows/governance.yml`](../.github/workflows/governance.yml) — weekly + manual; fails on gate exit 2.

---

## 8. Related artifacts

| ID | Artifact |
|----|----------|
| ART-007 | This document |
| ART-008 | `GOVERNANCE_STATUS.md` (generated) |
| ART-009 | `GITHUB_TRIAGE.md` (curated) |
| ART-010 | `FOUNDER_ACTION_LIST.md` (permission blockers) |

Registry: [`OPS_ARTIFACT_REGISTRY.md`](./OPS_ARTIFACT_REGISTRY.md)

---

*Every governance iteration must leave the repository measurably cleaner — fewer stale PRs, accurate docs, or resolved drift — not more paperwork.*
