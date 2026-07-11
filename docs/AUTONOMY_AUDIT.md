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

## After autonomous loop v2 (current)

| Step | Automation | Implementation |
|------|------------|----------------|
| Wake-up | ✅ | `autonomous-loop.yml`: cron → `gha-canary`, `workflow_dispatch`, `workflow_run` |
| Capability probe | ✅ | `capabilities.sh` → `orchestrator/capabilities.json` |
| Deploy gate | ✅ | `deploy-gate.sh` → `STANDBY` until prod SHA = main; **does not block** independent tasks |
| Deploy attempt | ⚠️ | `deploy.sh` if `VERCEL_TOKEN`; else Founder-only |
| Lease / lock | ✅ | `lease.sh` + `orchestrator/lease.json` |
| Dynamic discover | ✅ | `discover-work.sh` + `discover.sh` |
| Task select | ✅ | `prioritize.sh` merges catalog + discovered work |
| Execute (bounded) | ✅ | `handlers/*.sh` → `codex-agent.sh` (novel) → degrade safely |
| Validate | ✅ | `npm test`, lint, `verify:migrations` |
| Independent review | ✅ | `review.sh` + `adversarial-review.sh` |
| PR | ✅ | `gh pr create` in GHA with `contents` + `pull-requests: write` |
| CI wait + safe fix | ✅ | `ci-fix.sh` (lint auto-fix, bounded retries) |
| Merge | ✅ | When CI green + reviews pass |
| Prod verify | ✅ | Poll `/api/version`; record block if external |
| Persist state | ✅ | `state.json`, `autonomy-evidence.jsonl`, capabilities artifact |
| Continue | ✅ | `workflow_dispatch` chain with `actions: write` |

---

## GitHub permissions matrix (probed)

| Action | Cloud Agent (`cursor` integration) | GitHub Actions (`GITHUB_TOKEN`) |
|--------|-----------------------------------|--------------------------------|
| Push branches | ⚠️ Limited | ✅ `contents: write` |
| Create PR | ❌ `blocked_integration` | ✅ `pull-requests: write` |
| Merge PR | ⚠️ Untested in cloud | ✅ Expected |
| Close issues | ❌ `blocked_integration` | ✅ `issues: write` (GHA v2) |
| `workflow_dispatch` | ❌ `blocked_integration` | ✅ `actions: write` (GHA v2) |
| Vercel deploy | ❌ No `VERCEL_TOKEN` | ⚠️ Needs `VERCEL_TOKEN` secret |

**Repo-controlled fixes applied:** `autonomous-loop.yml` permissions expanded (`actions: write`, `issues: write`); removed `workflow_dispatch` inputs (phantom push bug [actions/runner#4001]); added `autonomous-canary.yml` for unattended proof.

**Founder-only (account-level):** Add `VERCEL_TOKEN`, `OPENAI_API_KEY` to GitHub Secrets; run `vercel deploy --prod`; batch-close issues/PRs via personal `gh` auth.

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
| `orchestrator/capabilities.json` | Runtime permission/credential probe |
| `orchestrator/discovered-work.json` | Dynamic work beyond static catalog |
| `orchestrator/lease.json` | Active lock |
| `docs/AUTONOMY_STATUS.md` | Human-readable last run summary |

*See latest entry in `autonomy-evidence.jsonl` for canary proof.*
