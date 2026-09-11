╔══════════════════════════════════════════════════════╗
║  >>> EXO GOVERNED SESSION                            ║
║  protocol: ExoProtocol v1 | mode: work               ║
║  ticket: TKT-20260911-113324-PIHV | actor: agent:codex║
║  model: gpt-5                                        ║
║  branch: chore/task-deposit-line-notification-20260911║
╚══════════════════════════════════════════════════════╝

# Exo Agent Session Bootstrap

session_id: SES-20260911113349-9436894E
actor: agent:codex
vendor: openai
model: gpt-5
mode: work
context_window_tokens: unknown
ticket_id: TKT-20260911-113324-PIHV
ticket_title: Guard automatic LINE deposit request claim against paid transitions
ticket_status: todo
ticket_priority: 95
topic_id: repo:default
lock_owner: agent:codex
git_branch: chore/task-deposit-line-notification-20260911
lock_branch: codex/TKT-20260911-113324-PIHV
lock_expires_at: 2026-09-11T13:33:49+08:00

## Scope
- allow: ["src/lib/payment-request-line.ts", "src/lib/payment-request-line.test.ts", "scripts/apply-migration-line-guest-notification-deliveries.mjs", "supabase/migration-line-guest-notification-deposit-request-guard.sql", "supabase/tracked-migration-contracts.json", ".exo/cache/**", ".exo/memory/**", ".exo/locks/**", ".exo/tickets/**", ".exo/logs/**"]
- deny: []

## Checks
- ["npm test", "npm run lint"]

## Git Workflow
- Before pushing, rebase on base branch: `git pull --rebase origin main`
- Pull latest before starting work: `git pull --rebase`
- Keep commits atomic and branches short-lived

## Machine Context
- cpu_cores: 12
- load_avg_1m: 0.9
- ram: 5.5GB available / 7.8GB total

## Start Advisories
- [INFO] Unmerged work on branch chore/task-TKT-20260903-110554-J9HK (ticket=TKT-20260903-110554-J9HK, actor=agent:codex) — Added branch-aware management links to today-page upcoming and unpaid reservatio
- [INFO] Unmerged work on branch chore/dashboard-reservation-focus-20260903 (ticket=TKT-20260903-103430-SFLJ, actor=agent:codex) — Added dashboard mobile and desktop reservation deep links into the existing bran

## Prior Session Memento
(none)

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
Restore atomic unpaid-state guard for automatic deposit requests and add regression tests.

## Lifecycle Commands
- heartbeat: EXO_ACTOR=agent:codex python3 -m exo.cli lease-heartbeat --ticket-id TKT-20260911-113324-PIHV --owner agent:codex
- run worker once: EXO_ACTOR=agent:codex python3 -m exo.cli worker-poll --require-session --limit 50
- suspend: EXO_ACTOR=agent:codex python3 -m exo.cli session-suspend --reason "<why pausing>"
- finish: EXO_ACTOR=agent:codex python3 -m exo.cli session-finish --summary "<what changed>" --set-status review --ticket-id TKT-20260911-113324-PIHV
