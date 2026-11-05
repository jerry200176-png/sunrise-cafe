# Synthetic payment receipt and refund concurrency study

This is a **research fixture**, not a production migration, application RPC, payment policy, or deployable integration. It uses fake values and a disposable PostgreSQL 17 container. It makes no requests to real Stripe, LINE, production databases, or customer notification services.

On a trusted local Docker installation with a preloaded `postgres:17-alpine` image:

```sh
python3 scripts/research/stripe-receipt-races/run.py
```

The harness uses a validated root-owned local Docker socket, empty Docker configuration, a sanitized environment, `--pull=never`, `--network none`, no Docker log driver, and a tmpfs database. It checks its container configuration, demonstrates lock waiting using `pg_blocking_pids`, and removes its own container. Image and daemon trust are external prerequisites.

The harness retains an assertion that a known conflicting event prevents a pending paid outbox claim, plus two-session tests for conflict-first and claim-first. An earlier fixture version demonstrated the unsafe claim; the synthetic fix serializes conflict publication and claims on the reservation lock.

The fixture assumes a caller has **already authenticated** each synthetic event and obtained a known provider intent and a full-refund semantic. It models two database transactions: a small first receipt commit, then a second event application that locks inbox → reservation → intent → outbox. It tests:

- Success and full refund in both observed lock orders, preserving refunded state and retaining both synthetic receipts.
- Cancellation of a pending paid outbox entry on refund, and the opposite race where an already claimed item leads to `refunded_delivery_reconcile`.
- Repeated and conflicting synthetic event IDs; a known conflict blocks a later claim. If claim wins first, the outbox stays claimed and conflict remains recorded. Mismatched amount, currency, or missing/incorrect binding remain recorded as reconciliation cases.
- A committed receipt remains after the synthetic application transaction fails and rolls back; a retry can then process it.

This does **not** prove a deployable payment workflow:

- A receipt cannot persist if the receive transaction fails; the app must then avoid acknowledgment, and provider retries are finite. Lost responses, crash points and monitoring still require an operational design.
- Once an outbox item is claimed, the fixture cannot unsend a message or prove that an external send did or did not occur. A later conflicting event also cannot undo an already claimed or delivered effect. The guard applies only when these synthetic functions hold the common reservation lock; other writers or an external send can bypass it. These cases need explicit reconciliation, guarded delivery and policy.
- Provider/account/environment event identity, signed payload authenticity, real refund and partial-refund semantics, tenant isolation, service-only grants/RLS, sensitive-data retention, evidence integrity, actual application writers, idempotency expiry, old deployments, and cutover/rollback are not implemented here.
- The fixture tests a small fixed lock order; it does not prove compatibility with other writers or absence of cross-reservation deadlocks. Old code can still overwrite state.
- Synthetic `refund_full` and outcome choices are assumptions for the experiment, not decisions about customer refunds or settlement.

The existing four application safety tests remain RED. Keep the draft and release hold until an independently reviewed migration, all payment writers, notification behavior, provider reconciliation, permissions, retention, and F1/F4 gates are addressed.
