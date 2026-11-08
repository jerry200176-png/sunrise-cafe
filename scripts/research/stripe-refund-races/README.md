# Synthetic Stripe refund ordering study

This is **not an application migration, production RPC, policy decision, or deployable payment implementation**. It uses disposable PostgreSQL 17 and fake data only; it does not call Stripe, LINE, the application, notifications, or any production service.

Run on a trusted workstation with a trusted local root-owned Docker socket and a preloaded `postgres:17-alpine` image:

```sh
python3 scripts/research/stripe-refund-races/run.py
```

The harness uses an empty Docker config, an explicit local Unix socket, `--pull=never`, `--network none`, no log driver, and a tmpfs database; it checks the resulting container configuration and removes its own container. A successful result does not establish the provenance or integrity of the Docker daemon or image.

The fixture models only a known reservation and intent with a synthetic, already verified full-refund event and fixed amount/currency. It acquires the reservation lock before the intent lock and, inside one transaction, records a minimal event plus state, audit, and synthetic outbox. Separate sessions demonstrate actual lock blocking with `pg_blocking_pids` before each commit. It checks both success/refund orders, distinct and duplicate success events, a conflicting event ID, unmatched amount/currency/kind, and a forced rollback followed by retry. Unknown and conflicting evidence in these tests is synthetic; it is not a real provider payload or signature.

The study exposes important gaps rather than resolving the application's four RED tests:

- After success followed by refund, the earlier paid outbox item remains. The fixture does **not** prove safe notification delivery or retraction.
- An unknown reservation fails before recording an event, and a transaction failure rolls its receipt back. A separate durable intake and recovery design is still needed; provider retry is finite.
- The fixture does not implement partial refunds, historical payment states, provider/account identity, guest authorization, production grants/RLS, existing schema, all application writers, effect delivery, or mixed-version cutover. Its full-refund assumption is not a policy for real payments.
- A single test reservation does not rule out cross-reservation event-identity lock cycles or other lock orders. No production guarantee follows from these tests.

Retain the real application RED tests and release hold until a reviewed design addresses these gaps, existing writers, financial reconciliation, privileges, retention, and the required F1/F4 gates.
