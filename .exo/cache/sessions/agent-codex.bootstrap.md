╔══════════════════════════════════════════════════════╗
║  >>> EXO GOVERNED SESSION                            ║
║  protocol: ExoProtocol v1 | mode: work               ║
║  ticket: TKT-20260914-205919-5YLL | actor: agent:codex║
║  model: gpt-5                                        ║
║  branch: chore/task-migration-delivery-bank-transfer-20260914║
╚══════════════════════════════════════════════════════╝

# Exo Agent Session Bootstrap

session_id: SES-20260914205924-6234ECF2
actor: agent:codex
vendor: openai
model: gpt-5
mode: work
context_window_tokens: unknown
ticket_id: TKT-20260914-205919-5YLL
ticket_title: Repair explicit production migration delivery coverage
ticket_status: todo
ticket_priority: 100
topic_id: repo:default
lock_owner: agent:codex
git_branch: chore/task-migration-delivery-bank-transfer-20260914
lock_branch: exo/TKT-20260914-205919-5YLL
lock_expires_at: 2026-09-14T22:59:24+08:00

## Scope
- allow: ["scripts/**", ".github/workflows/production-deploy-migrate.yml", "src/**/*.test.ts", ".exo/cache/**", ".exo/memory/**", ".exo/locks/**", ".exo/tickets/**", ".exo/logs/**"]
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
- ram: 5.8GB available / 7.8GB total

## Start Advisories
- [INFO] Unmerged work on branch chore/task-deposit-report-reconciliation-20260914 (ticket=TKT-20260914-183815-5ZOV, actor=agent:codex) — Verified PR #345 customer-report authorization, rate limiting, real disposable P
- [INFO] Unmerged work on branch fix/deposit-request-retry-key-20260911 (ticket=TKT-20260911-124334-F7CN, actor=human) — Aligned agent provenance task identifier with the follow-up branch name.
- [INFO] Unmerged work on branch chore/task-deposit-line-notification-20260911 (ticket=TKT-20260911-124334-F7CN, actor=human) — Added stable delivery-UUID retry keys and 24-hour automatic retry boundary for d
- [INFO] Unmerged work on branch chore/task-TKT-20260903-110554-J9HK (ticket=TKT-20260903-110554-J9HK, actor=agent:codex) — Added branch-aware management links to today-page upcoming and unpaid reservatio
- [INFO] Unmerged work on branch chore/dashboard-reservation-focus-20260903 (ticket=TKT-20260903-103430-SFLJ, actor=agent:codex) — Added dashboard mobile and desktop reservation deep links into the existing bran

## Prior Session Memento
(none)

## Operational Learnings
The following patterns have been learned from prior sessions. Heed these to avoid repeating known mistakes.

- [MEDIUM]! Shared database claim functions that expand notification types can silently lose type-specific eligibility predicates.
  -> When a delivery ledger is generalized for lifecycle events, preserve deposit_requests authoritative unpaid-state condition inside the atomic SQL claim; application-side prechecks cannot close approval-vs-send races.
  (ref: REF-20260911-113939-NCMP, scope: global)

## Tool Reuse Protocol

Before writing new utility functions, SEARCH the tool registry:
  exo tool-search "<keywords>"

After building a reusable utility, REGISTER it:
  exo tool-register <module> <function> --description "..."

### Registered Tools (3)
- `src.lib.line-guest-delivery.ts:claimLineGuestNotificationDelivery`: Atomically claim automatic guest LINE notification deliveries and return null when another process already owns the delivery.
- `src.lib.line-guest-delivery.ts:markLineGuestNotificationDelivery`: Record sent or failed state for an automatic guest LINE notification delivery.
- `src.lib.line-guest-delivery.ts:deliverLineGuestNotification`: Claim, send, and mark one automatic guest LINE lifecycle notification with durable dedupe and failure recording.

## Current Task
repair explicit migration delivery gap after approved rollback

## Lifecycle Commands
- heartbeat: EXO_ACTOR=agent:codex python3 -m exo.cli lease-heartbeat --ticket-id TKT-20260914-205919-5YLL --owner agent:codex
- run worker once: EXO_ACTOR=agent:codex python3 -m exo.cli worker-poll --require-session --limit 50
- suspend: EXO_ACTOR=agent:codex python3 -m exo.cli session-suspend --reason "<why pausing>"
- finish: EXO_ACTOR=agent:codex python3 -m exo.cli session-finish --summary "<what changed>" --set-status review --ticket-id TKT-20260914-205919-5YLL
