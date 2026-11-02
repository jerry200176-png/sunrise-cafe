# Staff add-items outcome warnings

This code-only candidate reduces same-page repeated submissions and distinguishes
a known committed add with an unrefreshed view from an unknown outcome. When a
request is unknown, staff are warned that it may still arrive later; confirming
allows only that next action and does not resolve the earlier unknown. A known
committed add is followed by a bounded, validated refresh. The API adds a
`not_attempted` marker only to explicitly pre-insert rejections; existing status
and `error` fields remain available to old clients. Unmarked errors remain
unknown. No database migration or live customer order is part of this candidate.

This is not durable idempotency and does not complete issue #441. The warning
exists only while its component is mounted: closing via the parent overlay,
switching room or branch, navigating away, reloading, another browser tab or
another device can lose or bypass it. A successful, parseable GET is not proof
that this particular add is visible in the returned order. The customer or staff
must not be told that refreshing, confirming, or leaving the panel cancels or
fences an earlier request. The full transactional ledger and mixed-client
compatibility remain separate database and rollout work.

Local isolated tests cover rapid same-render clicks, explicit unknown-outcome
confirmation, preserved unknown warnings, bounded reloads, incomplete results,
missing/null order-item arrays, absent order after a committed add, retryable
pre-insert rejection and legacy response fields. They do not establish live
database behavior or cross-device deduplication.
