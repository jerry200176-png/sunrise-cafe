╔══════════════════════════════════════════════════════╗
║  >>> EXO GOVERNED SESSION                            ║
║  protocol: ExoProtocol v1 | mode: work               ║
║  ticket: TKT-20260903-103430-SFLJ | actor: agent:codex║
║  model: gpt-5                                        ║
║  branch: chore/dashboard-reservation-focus-20260903  ║
╚══════════════════════════════════════════════════════╝

# Exo Agent Session Bootstrap

session_id: SES-20260903103459-1A067014
actor: agent:codex
vendor: openai
model: gpt-5
mode: work
context_window_tokens: unknown
ticket_id: TKT-20260903-103430-SFLJ
ticket_title: Deep-link dashboard reservations into edit workflow
ticket_status: todo
ticket_priority: 1
topic_id: repo:default
lock_owner: agent:codex
git_branch: chore/dashboard-reservation-focus-20260903
lock_branch: codex/TKT-20260903-103430-SFLJ
lock_expires_at: 2026-09-03T12:34:59+08:00

## Scope
- allow: ["src/app/admin/dashboard/page.tsx", "src/app/admin/page.tsx", "src/components/ReservationList.tsx", "src/components/**/*.test.tsx", ".exo/cache/**", ".exo/memory/**", ".exo/locks/**", ".exo/tickets/**", ".exo/logs/**"]
- deny: []

## Checks
- ["npm test", "npm run lint"]

## Git Workflow
- Before pushing, rebase on base branch: `git pull --rebase origin main`
- Pull latest before starting work: `git pull --rebase`
- Keep commits atomic and branches short-lived

## Machine Context
- cpu_cores: 12
- load_avg_1m: 1.1
- ram: 3.6GB available / 4.8GB total

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
Deep-link dashboard reservations into edit workflow

## Lifecycle Commands
- heartbeat: EXO_ACTOR=agent:codex python3 -m exo.cli lease-heartbeat --ticket-id TKT-20260903-103430-SFLJ --owner agent:codex
- run worker once: EXO_ACTOR=agent:codex python3 -m exo.cli worker-poll --require-session --limit 50
- suspend: EXO_ACTOR=agent:codex python3 -m exo.cli session-suspend --reason "<why pausing>"
- finish: EXO_ACTOR=agent:codex python3 -m exo.cli session-finish --summary "<what changed>" --set-status review --ticket-id TKT-20260903-103430-SFLJ
