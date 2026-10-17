# Local unpaid-booking closeout corrections

Base: PR #468 `af4942fb40f7fec3043b7e25f52d08278b4a9133`.
Local review packet only. The release/SQL HOLD in
[comment 6220318833](https://github.com/jerry200176-png/sunrise-cafe/pull/468#issuecomment-6220318833)
remains in force; approval of the previous head does not approve this patch.

## Customer copy delta

The LINE Pay request response and the booking query's expired-deadline notice
now explicitly say that passing the deadline does not automatically cancel the
booking. They direct guests to the existing bank transfer details and payment
report form, with store contact if details are unavailable or help is needed.
The booking query notice is updated in Chinese, English and Japanese.

The LINE Pay request still returns HTTP 409 after the deadline. This patch does
not change its eligibility rule, create a payment, or mutate a reservation.
It does not change transfer validation, payment review, reservation statuses,
availability rules, reminder delivery, migration runners or deployment gates.

## Corrections required before publishing the release description

- Remove a blanket claim that marking `no_show` releases booking capacity.
  At this head, `hasSlotConflict` in `src/lib/supabase-admin.ts` excludes only
  `cancelled`, so `no_show` still conflicts. Floor/checkout handling has separate
  status filters and must not be presented as a change to booking availability.
  ADR-012 removes unpaid-deposit automatic cancellation; it does not introduce a
  no-show capacity policy.
- Replace any requirement for strictly positive `reminded` / `urgentReminded`
  counts with an eligibility-aware check. Zero is valid when no rows are due,
  guests have no LINE binding, reminders are already stamped, or delivery claims
  suppress duplicates. Capture actual eligibility and delivery evidence under a
  separately authorized verification plan; do not manufacture a production
  booking or trigger a reminder merely to obtain positive counters.
- `released` remains zero for new deadline-driven cancellation. Historical
  failed release-group notifications can still be retried; those historical
  deliveries do not establish that a new reservation was cancelled.
- The copied release description must say that deployment, SQL application and
  live verification remain on hold. Local tests are not production readiness
  evidence. Any eventual integration requires review of the exact new head.

## Verification and remaining boundary

The LINE Pay regression covers overdue `pending` and `confirmed` bookings: HTTP
409, no payment URL, no provider request, no database client call, and unchanged
unpaid reservation state. Reminder, paging, deadline, explicit cancellation and
locale smoke suites provide bounded related coverage.

Seven focused suites pass (58 tests); lint passes with two existing unused-variable
warnings. `git diff --check` passes. These checks do not contact a payment provider
or database.

Reuse the migration inventory in local preflight commit
`0b113ee31b4237bec449c4e35fba7aef22b5fcd7`,
`docs/research/2026-10-17-migration-preflight.md`. That standalone preflight is not
a complete release readiness gate. Its outstanding runner/bootstrap inventory,
database evidence and execution boundaries are unchanged by this copy patch.

The original shared `node_modules` is missing the four pinned Three dependencies
documented there. A separate clean `npm ci --ignore-scripts` install now exists in
the preflight worktree for broader baseline verification. This patch does not
alter `package.json` or `package-lock.json` to work around local dependencies.

No remote branch, PR body/comment, merge, deployment, workflow run, production
SQL, backup/export/restore, secret or setting was changed by this packet.
