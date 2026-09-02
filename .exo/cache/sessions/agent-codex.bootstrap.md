╔══════════════════════════════════════════════════════╗
║  >>> EXO GOVERNED SESSION                            ║
║  protocol: ExoProtocol v1 | mode: work               ║
║  ticket: INT-20260903-020239-HCJ8 | actor: agent:codex║
║  model: gpt-5                                        ║
║  branch: chore/task-reservation-notification-dedupe-20260902║
╚══════════════════════════════════════════════════════╝

# Exo Agent Session Bootstrap

session_id: SES-20260903020245-ADC187F4
actor: agent:codex
vendor: openai
model: gpt-5
mode: work
context_window_tokens: unknown
ticket_id: INT-20260903-020239-HCJ8
ticket_title: Prevent duplicate LINE payment requests
ticket_status: todo
ticket_priority: 90
topic_id: repo:default
lock_owner: agent:codex
git_branch: chore/task-reservation-notification-dedupe-20260902
lock_branch: codex/INT-20260903-020239-HCJ8
lock_expires_at: 2026-09-03T04:02:44+08:00

## Scope
- allow: ["src/lib/payment-request-line.ts", "src/lib/payment-request-line.test.ts", "src/lib/line-guest-delivery.ts", "src/lib/line-guest-delivery.test.ts", "src/lib/bootstrap-migrations.ts", "supabase/migration-line-guest-notification-deliveries.sql", "supabase/tracked-migration-contracts.json", ".exo/cache/**", ".exo/memory/**", ".exo/locks/**", ".exo/tickets/**", ".exo/logs/**"]
- deny: []

## Checks
- ["npm test", "npm run lint"]

## Git Workflow
- Before pushing, rebase on base branch: `git pull --rebase origin main`
- Pull latest before starting work: `git pull --rebase`
- Keep commits atomic and branches short-lived

## Machine Context
- cpu_cores: 12
- load_avg_1m: 0.2
- ram: 3.4GB available / 4.8GB total

## Prior Session Memento
(none)

## Tool Reuse Protocol

Before writing new utility functions, SEARCH the tool registry:
  exo tool-search "<keywords>"

After building a reusable utility, REGISTER it:
  exo tool-register <module> <function> --description "..."

No tools registered yet. Register reusable utilities as you build them.

## Current Task
Implement database-backed deduplication for automatic LINE deposit payment requests, with retry state and tests.

## Lifecycle Commands
- heartbeat: EXO_ACTOR=agent:codex python3 -m exo.cli lease-heartbeat --ticket-id INT-20260903-020239-HCJ8 --owner agent:codex
- run worker once: EXO_ACTOR=agent:codex python3 -m exo.cli worker-poll --require-session --limit 50
- suspend: EXO_ACTOR=agent:codex python3 -m exo.cli session-suspend --reason "<why pausing>"
- finish: EXO_ACTOR=agent:codex python3 -m exo.cli session-finish --summary "<what changed>" --set-status review --ticket-id INT-20260903-020239-HCJ8
