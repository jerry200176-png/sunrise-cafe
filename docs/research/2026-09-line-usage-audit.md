# Sunrise LINE usage audit — 2026-09-09 dry run

## Scope and evidence

This is a dry-run estimate from `npm run line:usage-audit`, using the current
notification call sites and a 30-day test fixture. No production credential was
available in this task worktree, so the numbers below are not production truth.
The read-only production check is wired through
`GET /api/admin/diagnose-line?code=...`; it queries LINE monthly consumption,
monthly quota and today’s Messaging API push count without sending a test
message unless `send=1` is explicitly supplied.

LINE’s official count is channel-wide and recipient-based. Multiple message
objects in one push request do not increase the count; a group push is counted
by the number of recipients in the group. Therefore this audit reports
delivery units, and the group rows must be multiplied by the real group
membership for a quota estimate. LINE Official Account Manager sends are also
included in monthly consumption, while reply messages are not.

## Dry-run result

| Scope | Before | After | Estimated saving |
|---|---:|---:|---:|
| All quota-counted push units | 481 | 450 | 31 / 6.4% |
| Group push units | 217 | 186 | 31 / 14.3% |

Main modeled savings:

- `deposit release group`: 20 individual pushes → 4 requests (up to five Flex
  message objects per request), while each reservation retains its own claim.
- unchanged `empty` / `already_notified` heartbeat: 30 daily informational
  pushes → 15 under the 36-hour same-state cooldown. The heartbeat is retained;
  it is not removed.

## Source inventory and classification

| Source | Class | Current behavior | Change in this task |
|---|---|---|---|
| D-1 group reminder | actionable | per branch digest, delivery ledger | unchanged |
| D-1 / D-7 guest reminders | actionable/informational | per-recipient carousel digest and ledger | unchanged |
| Deposit initial / urgent reminders | actionable | deadline flags + delivery ledger | unchanged |
| Deposit release guest | critical | one guest push, delivery ledger | unchanged |
| Deposit release group | critical | one push per released reservation | batch up to 5; provider retry key reused once |
| New booking / payment review / payment approval | actionable/critical | immediate staff notification; approval has DB + provider idempotency | unchanged |
| Cancel / reschedule / attendance / waitlist | actionable | lifecycle dedupe or one-shot state markers | unchanged |
| Empty / already-notified heartbeat | informational | scheduled group heartbeat | 36-hour same-key cooldown + optional budget/surge guard |
| Webhook replies | actionable | reply API | not quota-counted by LINE |
| Cron failure / deploy alerts | critical | immediate staff alert | never budget-suppressed |

## Root causes

1. The deposit deadline cron claimed each group release independently and then
   issued one push request per reservation. This is the direct reducible source
   addressed by the batch sender.
2. Empty-state heartbeats repeated while the state was unchanged. This is
   informational noise, so it now has a durable job-run cooldown.
3. LINE’s quota endpoint cannot attribute channel usage to application source;
   source attribution requires the existing `job_runs` metadata and event
   records plus a scenario audit such as this one.

## Reliability guardrails

- Existing D-1, D-7, deposit deadline, guest lifecycle and payment approval
  dedupe behavior remains in place.
- Group batch requests contain independent Flex cards and never silently drop a
  claimed reservation. The batch is retried once with the same
  `X-Line-Retry-Key`; an ambiguous accepted request therefore reconciles as
  HTTP 409 rather than producing a duplicate.
- If a release batch still fails after the provider-key retry, the failed group
  delivery is retained and the next cron run can reclaim it even though the
  reservation was already cancelled; the reclaim uses a compare-and-swap on
  the ledger status and attempt count.
- Critical/actionable notifications are exempt from quota throttling.
- If the delivery ledger is unavailable in production, automatic reminder
  sends fail closed as before.
- Empty-message behavior remains available; only unchanged informational state
  is cooled down.

## Production activation gate

Before activation, run the read-only quota endpoint and compare the result with
`job_runs` for at least one complete 30-day window. Do not enable the optional
budget variables or promote the code until the operator confirms the actual
group membership, current monthly limit, source mix, and failure-retry evidence.
