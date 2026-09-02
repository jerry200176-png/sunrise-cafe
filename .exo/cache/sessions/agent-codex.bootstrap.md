╔══════════════════════════════════════════════════════╗
║  >>> EXO GOVERNED SESSION                            ║
║  protocol: ExoProtocol v1 | mode: work               ║
║  ticket: INT-20260903-023726-2M79 | actor: agent:codex║
║  model: gpt-5                                        ║
║  branch: chore/task-reservation-ledger-production-migration-20260903║
╚══════════════════════════════════════════════════════╝

# Exo Agent Session Bootstrap

session_id: SES-20260903023739-A8CBF011
actor: agent:codex
vendor: openai
model: gpt-5
mode: work
context_window_tokens: unknown
ticket_id: INT-20260903-023726-2M79
ticket_title: Apply guest notification ledger in production
ticket_status: todo
ticket_priority: 95
topic_id: repo:default
lock_owner: agent:codex
git_branch: chore/task-reservation-ledger-production-migration-20260903
lock_branch: codex/INT-20260903-023726-2M79
lock_expires_at: 2026-09-03T04:37:39+08:00

## Scope
- allow: ["scripts/apply-migration-line-guest-notification-deliveries.mjs", ".github/workflows/production-deploy-migrate.yml", ".exo/cache/**", ".exo/memory/**", ".exo/locks/**", ".exo/tickets/**", ".exo/logs/**"]
- deny: []

## Checks
- ["npm test", "npm run lint"]

## Git Workflow
- Before pushing, rebase on base branch: `git pull --rebase origin main`
- Pull latest before starting work: `git pull --rebase`
- Keep commits atomic and branches short-lived

## Machine Context
- cpu_cores: 12
- load_avg_1m: 2.6
- ram: 3.3GB available / 4.8GB total

## Prior Session Memento
(none)

## Tool Reuse Protocol

Before writing new utility functions, SEARCH the tool registry:
  exo tool-search "<keywords>"

After building a reusable utility, REGISTER it:
  exo tool-register <module> <function> --description "..."

### Registered Tools (2)
- `src.lib.line-guest-delivery.ts:claimLineGuestNotificationDelivery`: Atomically claim automatic guest LINE notification deliveries and return null when another process already owns the delivery.
- `src.lib.line-guest-delivery.ts:markLineGuestNotificationDelivery`: Record sent or failed state for an automatic guest LINE notification delivery.

## Current Task
Add an idempotent production migration runner and invoke it from the sole production deploy workflow.

## Lifecycle Commands
- heartbeat: EXO_ACTOR=agent:codex python3 -m exo.cli lease-heartbeat --ticket-id INT-20260903-023726-2M79 --owner agent:codex
- run worker once: EXO_ACTOR=agent:codex python3 -m exo.cli worker-poll --require-session --limit 50
- suspend: EXO_ACTOR=agent:codex python3 -m exo.cli session-suspend --reason "<why pausing>"
- finish: EXO_ACTOR=agent:codex python3 -m exo.cli session-finish --summary "<what changed>" --set-status review --ticket-id INT-20260903-023726-2M79
