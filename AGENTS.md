# AGENTS.md — sunrise-cafe entry (tool-neutral)

Portfolio Constitution (canonical): pin via [`docs/governance/OVERLAY.md`](docs/governance/OVERLAY.md) → AllTrue `docs/governance/COMPANY_CONSTITUTION.md`.

## First-read

1. This file + [`docs/governance/OVERLAY.md`](docs/governance/OVERLAY.md)
2. [`CLAUDE.md`](CLAUDE.md) (product adapter)
3. [`docs/internal/governance/ENGINEERING_GOVERNANCE.md`](docs/internal/governance/ENGINEERING_GOVERNANCE.md)
4. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) / [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
5. `npm run cto:governance` when hygiene is in scope

## Launch gateway

- Official: `agent-start sunrise <task-id>`
- Bare: `/home/jerry/workspace/repos/sunrise-cafe.git`
- Tasks: `/home/jerry/workspace/tasks/sunrise/<task-id>/`
- Commit `.agent-session/manifest.json` on Agent PRs (or `human-authored.json`).
- Cloud sessions (Claude Code on the web/mobile; no `/home/jerry` workspace): use `provenance_type: "agent-session-cloud"` with `session_id` (`cse_…`), `session_urls`, `preflight_mode: "cloud"`, `runner: "claude-code-remote"`; every non-merge commit must end with a `Claude-Session: <url>` trailer listed in `session_urls` (verified by `scripts/check-agent-provenance.sh`). `npm run agent-preflight` detects the cloud runner and skips only the path allowlist and `gh` checks; branch naming, fresh base, origin, Exo ownership and dirty-tree rules still apply. Cloud has no `agent-start`, so after `exo session-start` run `AGENT_PREFLIGHT_BOOTSTRAP_MANIFEST=1 npm run agent-preflight` once per session on a `<type>/task-<TASK-ID>` branch: preflight itself writes the manifest (keeping the base and earlier session URLs when this branch already has one); never hand-edit it.

## Hard rules

- Before any write: `npm run agent-preflight` (must exit 0). Official allowlisted worktrees are `/home/jerry/workspace/tasks/sunrise/<task-id>/`, created by `agent-start sunrise <task-id>`; legacy checkouts are not write paths.
- Production truth: `npm run production-identity` — CI green / merge / deploy success alone is insufficient.
- Do **not** mix changes with AllTrue System in one PR.
- Do **not** re-enable `.github/workflows/autonomous-loop.yml` without fixing capability probes (self-`gh workflow run` caused cancel storms; workflow is **disabled_manually** as of 2026-07-18).
- Production verify: `verify-production.yml` / `GET /api/version` SHA match.
- Prefer Evidence over governance score green alone (`GOVERNANCE_STATUS.md` can be stale).
- Windows `/mnt/c/**` clones are not source of truth.

<!-- exo:governance:begin -->
<!-- Governance hash: f45f0f00b0698aa4 -->
# ExoProtocol — Agent Operating Instructions

This repository is governed by ExoProtocol. All AI agent work must follow the session lifecycle.

## ExoProtocol Governance

- kernel: exo-kernel 0.1.0
- lock hash: `f45f0f00b0698aa4...`
- generated: 2026-08-15T14:52:35+08:00

### Filesystem Deny Rules

- **RULE-SEC-001**: deny read, write on `~/.aws/**`, `~/.ssh/**`, `**/.env*`
- **RULE-GIT-001**: deny read, write, delete on `.git/**`

### Structural Rules

- **RULE-LOCK-001** (require_lock): Blocked by RULE-LOCK-001 (acquire a ticket lock first).
- **RULE-CHECK-001** (require_checks): Blocked by RULE-CHECK-001 (checks must pass before done).
- **RULE-EVO-001** (evolution_gate): Practice is mutable, governance requires explicit human approval.
- **RULE-EVO-002** (patch_first): Patch-first evolution required.

### Default Budgets

- max files changed: 12

### Approved Checks

- `npm test`
- `npm run lint`
- `pytest`
- `python -m pytest`
- `python3 -m pytest`

### Source of Truth

The values above are a **snapshot** generated from the governance manifest.

Manifest paths:
- `.exo/config.yaml` — budgets, checks allowlist, scheduler config
- `.exo/governance.lock.json` — compiled rules, deny patterns, source hash

### Test-Driven, Manifest-First Workflow

This principle applies to **all code you write** — governance and application logic alike.

1. **Config/contract is the source of truth.** When a value is defined in a config file,
   schema, manifest, or contract — code must load it from that source at runtime.
   Never copy a value from a config file and paste it as a literal in source code.
2. **Tests verify the wiring, not the value.** Tests must assert that code reads from
   the config/contract, not that it produces a specific hardcoded result.
   A test that passes when you swap the config value *and* swap the assertion is useless —
   it only proves both sides were copy-pasted from the same place.
3. **If you can change a config value and no test breaks, the test is missing.**
   Every configurable value should have at least one test that will vary the input
   and verify the output follows.

Examples:
- **BAD**: `assert budget == 10` (hardcoded, passes even if config is ignored)
- **GOOD**: set config to 42, assert output contains 42 and not the old default
- **BAD**: `MAX_RETRIES = 3` (literal in source when retries is in config)
- **GOOD**: `max_retries = load_config()['max_retries']`

### Operational Learnings

When you discover a reusable pattern, gotcha, or operational insight during a session:
- Record it with `exo reflect` (CLI) or `exo_reflect` (MCP) — NOT your private memory
- ExoProtocol reflections are injected into future session bootstraps for all agents
- Private memory files (MEMORY.md, .cursorrules, etc.) are agent-specific and invisible to the team
- If you must write to private memory, also create an ExoProtocol reflection with the same insight

**Private memory monitoring**: If `private_memory.watch_paths` in `.exo/config.yaml` is empty,
add the absolute path to your memory file (e.g., `~/.claude/.../memory/MEMORY.md`) so that
ExoProtocol can detect when you write to private memory without creating a shared reflection.

### End-of-Work Reflection

When you complete significant work or the user appears to be wrapping up:
- **Proactively** run `exo reflect --pattern '<what kept happening>' --insight '<what was learned>'`
  for each non-trivial insight discovered during the conversation
- Do NOT wait for `session-finish` — many users close the editor without explicit session end
- Good reflection triggers: bug fixes, CI failures, gotchas, architectural decisions, workflow improvements

### Tool Reuse Protocol

Before writing new utility functions, SEARCH the tool registry:
  `exo tool-search "<keywords>"`

After building a reusable utility, REGISTER it:
  `exo tool-register <module> <function> --description "..."`

Mark a tool as used when you import/call it:
  `exo tool-use <tool_id>`


## Session Lifecycle

1. `exo session-start --ticket-id <TICKET> --vendor <VENDOR> --model <MODEL> --task "<TASK>"`
2. Read `.exo/cache/sessions/<actor>.bootstrap.md`
3. Execute work within ticket scope
4. `exo session-finish --ticket-id <TICKET> --summary "<SUMMARY>" --set-status review`

## Enforcement

- Governance rules are enforced at the kernel level, not by prompt
- The bootstrap file contains your session's scope, checks, and lifecycle commands
- Drift detection runs at session-finish and is recorded in the session memento
- Audit sessions may be triggered to review your work independently

## Governed Push

Before pushing code, ALWAYS run checks first:

```
exo push                      # runs exo check, then git push (recommended)
# OR
exo check && git push         # manual equivalent
```

Do NOT use bare `git push` — it bypasses governance checks.
If checks fail, fix the issues before pushing.

## Non-Negotiables

- No governed execution without active session
- Respect lock ownership and ticket scope
- Verification is default at finish; break-glass must be explicit
- All configurable values must be loaded from their source of truth at runtime — never hardcode, always test
- Read `.exo/LEARNINGS.md` for operational learnings from prior sessions

<!-- exo:governance:end -->

## Portfolio governance overlay

Read `governance/PORTFOLIO_AGENT_CONTRACT.md` before writing. It is committed
for cloud/mobile agents and contains the company's PR, approval, production,
and Founder-approval boundaries.
