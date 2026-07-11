# Autonomy Audit — What Is Actually Automated

**Updated:** 2026-07-11  
**Rule:** No claim of autonomy without a runnable path and evidence artifact.

---

## Environment probe (this repository)

| Interface | Installed? | Unattended? | Evidence |
|-----------|------------|-------------|----------|
| **Cursor Desktop / Agent API** | ❌ Not in PATH | ❌ No supported non-interactive API | `type cursor` → not found; Cloud Agent requires human session start |
| **Codex CLI** (`npx @openai/codex`) | ✅ via npx | ⚠️ Only if `OPENAI_API_KEY` in CI | `codex exec` exists; no key in cloud pod |
| **GitHub CLI** (`gh`) | ✅ | ⚠️ Limited token | `cursor` integration: cannot close issues; can push branches + merge PRs in Actions |
| **GitHub Actions** | ✅ | ✅ Scheduled + `workflow_run` + `workflow_dispatch` | Workflows in `.github/workflows/` |
| **Vercel CLI** | ✅ via npx | ❌ Needs `VERCEL_TOKEN` | Not set in agent pod; production deploy externally blocked |

**Conclusion:** The real unattended executor is **GitHub Actions + repository scripts**. Codex is optional when `OPENAI_API_KEY` is configured. Cursor cannot be invoked headlessly from this environment.

---

## Before this iteration (honest status)

| Capability | Status | Gap |
|------------|--------|-----|
| Discover signals | ✅ Automated | `discover.sh` |
| Prioritize tasks | ✅ Automated | `prioritize.sh` |
| Generate plan markdown | ✅ Automated | `plan.sh` — **documentation only** |
| Execute code changes | ❌ **Interactive** | Required Cursor Cloud Agent session |
| Create PR | ⚠️ Partial | Agent manual; GHA token untested for auto-PR |
| Review diff | ❌ Interactive | Human/agent judgment |
| Merge | ⚠️ Partial | Agent `gh pr merge` works |
| Deploy verify | ⚠️ Broken | `verify-production.yml` invalid `if: secrets.*` |
| Continue next task | ❌ None | No event chain |
| Locking / idempotency | ❌ None | Duplicate session risk |

---

## After autonomous loop (target)

| Step | Automation | Implementation |
|------|------------|----------------|
| Wake-up | ✅ | `autonomous-loop.yml`: cron, `workflow_dispatch`, `workflow_run` |
| Deploy gate | ✅ | `deploy-gate.sh` → `STANDBY` until prod SHA = main |
| Lease / lock | ✅ | `lease.sh` + `orchestrator/lease.json` |
| Task select | ✅ | `cto:orchestrator` discover + prioritize |
| Execute (bounded) | ✅ | `handlers/*.sh` scripted; optional `codex exec` |
| Validate | ✅ | `npm test`, lint, `verify:migrations`, `review.sh` |
| PR | ✅ | `gh pr create` in GHA with `contents: write` |
| Review | ✅ | Scripted policy checks; optional Codex `exec review` |
| Merge | ✅ | When CI green + review pass + policy allow |
| Prod verify | ✅ | Poll `/api/version`; record block if external |
| Persist state | ✅ | `state.json`, `autonomy-evidence.jsonl`, lease |
| Continue | ✅ | `workflow_dispatch` self-trigger when idle + work queued |

---

## Operational modes (`orchestrator/state.json`)

| Mode | Meaning | Loop behavior |
|------|---------|---------------|
| **LIVE** | `main` SHA deployed to production | Full autonomous iterations |
| **STANDBY** | Prod SHA drift or Vercel blocked | Code/docs PRs allowed; **no LIVE claim**; deploy recorded as external blocker |
| **BLOCKED** | Founder-only queue head | Run independent tasks only |
| **IDLE** | No executable tasks | Safe stop; wake on schedule |

---

## Founder-only (never autonomous)

- DB migrations (Supabase dashboard)
- Secrets / env vars
- Closing GitHub issues/PRs (integration restriction)
- `vercel deploy --prod` without token
- Destructive production changes
- Financial / irreversible decisions

---

## Evidence artifacts

| File | Purpose |
|------|---------|
| `orchestrator/autonomy-evidence.jsonl` | Append-only canary/iteration proof |
| `orchestrator/lease.json` | Active lock |
| `docs/AUTONOMY_STATUS.md` | Human-readable last run summary |

*See latest entry in `autonomy-evidence.jsonl` for canary proof.*
