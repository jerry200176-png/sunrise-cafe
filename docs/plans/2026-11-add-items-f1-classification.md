# #502 migration finding classification and execution package — draft only

This is a review package, **not permission or an instruction to run SQL**. The production
release is on hold. It does not change the migration, plan, classification, allowlist or gate.
Evidence below is from repository text and isolated synthetic PostgreSQL; production object
existence, role grants, current data, and runtime database identity remain unknown.

## Exact artifacts and target

| Item | Value / limitation |
| --- | --- |
| Candidate application / SQL | PR #502 `b297dc6d5ff3e771071d4bb8337b3cc5b0f6fb28`; reviewed against main `11f6d0308e46607414e4c33d596561a49ab9c5de`. |
| SQL path and SHA-256 | `supabase/migrations/20261031173613_reservation_order_add_items_idempotency.sql`; `e667bd204cc2038114b291da62764c3d498f40f310c518dee626f829ead80d97`. |
| Production migration plan SHA-256 | `6362f79a4b8bce27eca7aa60a75b60d45f18f057151084337f1643033dcb2f36`; **candidate is not an entry**. Do not add it as `grandfathered` or assert approval. |
| Candidate database | Named Supabase project `Sunrise_Cafe`; project name and public metadata are **not proof** that Vercel runtime, the SQL connection and backup have the same database identity. Target, environment and TLS must be independently bound before execution. |
| Local evidence | `145227a` adds isolated PG17 + PostgREST 12 + supabase-js checks. `tests/research-additive-semantics.py` tests generic PG17 semantics in a separate network-none tmpfs container; neither inspects production. |

## Thirteen findings, line by line

`node scripts/check-additive-sql.mjs supabase/migrations/20261031173613_reservation_order_add_items_idempotency.sql`
reports exactly 13 findings on the SQL hash above. These categories describe the SQL's
semantics; they **do not override** the committed classifier, rulebook, CI or F1/F4.
"Runtime" below means after another caller or trigger invokes the function; no claim is made
that current production contains a particular object or role assignment.
The separate read-only `node tests/research-additive-findings.mjs` verifies the candidate
hash and the complete line/rule list; it is not an approval or a replacement for the gate.

| Line | Class | Concrete effect and condition |
| --- | --- | --- |
| 15 | ACL | `REVOKE` removes any matching table grants that exist. On a fresh table it establishes restricted access and may be a no-op; because `CREATE TABLE IF NOT EXISTS` may reuse a pre-existing object, it could remove existing grants. F4 depends on the actual access policy and whether it is already decided, not merely this keyword. |
| 18 | Possible existing-object rewrite | `CREATE OR REPLACE` creates an absent add RPC, but overwrites an existing same-signature function body if present. That is a real non-additive replacement, not a benign lexical match, when the object already exists. |
| 72 | Runtime DML; conservatively flagged | `UPDATE orders` is inside the add RPC body. Defining the function alone does not execute this UPDATE; a later successful invocation modifies a real order inside its transaction. Triggers and current writer behavior remain material. |
| 79 | ACL | `REVOKE` removes matching add RPC execute privileges if present. New functions ordinarily grant `PUBLIC` execute unless owner default privileges alter that; removing this statement to appease the gate could expose the RPC. |
| 80 | ACL / lexical `EXECUTE` finding | `GRANT EXECUTE ... TO service_role` grants a privilege; it is **not** PL/pgSQL dynamic `EXECUTE`. It still changes ACL and must be reviewed against intended role access. |
| 84 | Possible existing-object rewrite | `CREATE OR REPLACE` for cancellation RPC creates a new function only if the signature is absent; otherwise it overwrites existing behavior. |
| 104 | ACL | `REVOKE` removes matching cancellation RPC execute privileges if present; it is required by this candidate to exclude PUBLIC, anon and authenticated. |
| 105 | ACL / lexical `EXECUTE` finding | `GRANT EXECUTE` for cancellation RPC is a role grant, not dynamic SQL; assess actual service-role ACL. |
| 111 | Possible existing-object rewrite | `CREATE OR REPLACE` on the status-derivation trigger function may overwrite an existing same-signature body. It is `SECURITY DEFINER`; owner, search path, caller access and current triggers matter. |
| 128 | ACL | `REVOKE` removes matching execute privileges on the status-derivation trigger function if present. Trigger execution and direct RPC execute are separate concerns. |
| 132 | Possible existing-object rewrite | `CREATE OR REPLACE` on the item-refresh trigger function has the same existing-object caveat; this function is also `SECURITY DEFINER`. |
| 137 | Runtime DML; conservatively flagged | `UPDATE orders SET status = status` is inside the item trigger function; defining it does not backfill orders. Future INSERT/UPDATE/DELETE of items can invoke it within the writer's transaction and cause another order update/status trigger. |
| 141 | ACL | `REVOKE` removes matching execute privileges on the item-refresh trigger function if present; verify owner/default privileges and callers. |

The two `GRANT EXECUTE` matches are lexical dynamic-SQL false positives **only for that
specific rule**: the grants are real ACL changes. An UPDATE within a function is still real
DML when invoked; it is not evidence that applying this file immediately backfills rows.
Four `CREATE OR REPLACE` statements are dangerous if signatures already exist. Five
`REVOKE` statements are real ACL operations, though their effective impact depends on existing
and default privileges. The classifier intentionally blocks all 13;
do not add markers or alter SQL merely to make the gate pass.

Additional risk outside the 13: lines 129–130 and 142–143 add triggers to existing tables.
They do not proactively rewrite all rows, but they change future writes by **all** callers,
take table-level DDL locks while the transaction is open, and can change lock ordering,
status, performance, or cause previously successful writes to fail. The file contains no
explicit one-time `UPDATE`/`DELETE` backfill outside function bodies. That observation is
not proof that existing triggers, event triggers, or concurrent production calls are harmless.
`IF NOT EXISTS` is not a schema/ACL equivalence check; same-name objects, triggers and stale
ledger rows must cause a stop until their exact state is reviewed.

## Is a genuinely additive split available?

Replacing `CREATE OR REPLACE` with plain `CREATE FUNCTION` could **fail closed on a name
collision**, which local PG17 demonstrates, but it changes the SQL hash, requires new review
and does not resolve the other nine findings, permission changes, trigger effects or rollout.
It is a design option, not an approved or production-ready migration. Creating the functions
without restrictive ACL is not acceptable: the isolated test confirms a newly created
function is executable through `PUBLIC` under PostgreSQL's standard defaults. Depending on
unverified database default privileges, hiding SQL from the analyzer, removing REVOKEs, or
changing the global default privileges is not a safe additive workaround. No candidate has
yet established a fully equivalent, genuinely additive, gate-passing rollout.

## Preflight and execution order, if separately authorized

1. Resolve the release hold and prepare an exact, reviewed application + migration commit;
   re-run exact-head CI, independent review, classifier and migration plan checks. Document
   the rulebook decision for every change of schema/ACL/policy; do not convert a label or
   this research into founder authorization. Apply no migration until that path is available.
2. Bind the production Vercel runtime target, PostgreSQL connection and backup origin using
   approved metadata-only checks and TLS. Obtain a sufficiently recent recovery point for
   that same target, verify its source and isolated restore; record what it covers and test
   Auth/Storage/roles/extensions separately as appropriate. The user's prior public-schema
   restore demonstrates only a partial historical recovery, not complete Supabase recovery.
3. Inspect only bounded catalog metadata for the named table/functions/triggers and their
   owners, role memberships/default ACLs, `anon`/`authenticated`/`service_role` execute and
   table permissions, RLS, constraints, current trigger order and existing writer contracts.
   Check whether objects already exist and if so their definitions; mismatches stop the plan.
   Do not retrieve customer rows or secret values. Verify all writers, transaction isolation,
   external consumers and room/order relationships, including `order_items.order_id` changes.
4. Establish a maintenance window: stop new add/edit/serve/settlement operations using a
   verified application admission mechanism, drain in-flight and older worker requests, and
   reconcile unresolved requests. Confirm affected staff can recover pending operations.
   A browser-only disable or request timeout alone is not proof of a writer fence.
5. In a disposable synthetic clone with production-equivalent schema and role grants, run the
   reviewed exact SQL through the authorized gate; test same-key and distinct-intent behavior,
   role denial, payload mismatch, tombstone race, unknown response, status triggers, lock
   waits/deadlocks, settlement in both orders, delete/cascade, rollback, all known old/new
   writer combinations and `order_id` moves. No live customer or provider requests.
6. Only after F1/F4 and target checks are satisfied, apply the approved exact artifact via
   the committed pipeline with bounded lock/statement timeouts, stop on any mismatch and
   verify exact resulting object definitions/ACL. There is currently **no production-plan
   entry or approved execution path**. Establish D7/stop handling before this step, not after.
7. Deploy the matching app using the committed release process; verify version, health and
   permitted synthetic observations, then restore admission. Retain pending keys and ledger
   records; staff must be able to distinguish confirmed, canceled and unknown results.

## Recovery and mixed versions

Migration is wrapped in one SQL transaction, so a pre-COMMIT SQL error should roll back that
transaction; a lost COMMIT response is **unknown**, not proof of rollback. Re-read named
schema/ACL metadata and establish the actual state before any retry. Retain evidence and stop
writers if target identity or transaction result is unknown. Do not drop the ledger or its
tombstones, disable triggers, or restore data over production as an automatic rollback.
Reverting to an old app with no idempotency key can duplicate late retries; disable adding and
reconcile pending operations before any app rollback. A future schema/data rollback, privilege
change or restore requires its own tested script, dependency analysis and applicable F1/F2/F4
decision. Retention of ledger/tombstones, including cascade delete, is a separate unresolved
operational/privacy decision.

## References and local evidence

- [PostgreSQL GRANT](https://www.postgresql.org/docs/17/sql-grant.html) and [default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html): PUBLIC privileges, role/owner defaults; do not infer actual Supabase ACL from defaults.
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): `CREATE TRIGGER` takes a `SHARE ROW EXCLUSIVE` table lock. Synthetic PG17 demonstrates concurrent insert timeout until trigger-creation transaction commits.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions): privilege and invoker/definer boundaries; verify actual RLS, schema exposure and grants.
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests): stable request key and distinct parameter mismatch; this informs behavior, not proof of the candidate's implementation.
- `tests/research-additive-semantics.py` uses a new local `--network none` PG17 tmpfs container and synthetic roles/data. It validates PUBLIC function execute under default PG settings, `REVOKE`, actual `CREATE OR REPLACE` replacement, plain `CREATE` collision failure, function-body UPDATE only on call, transaction rollback, and an observed `CREATE TRIGGER` lock. No real database was inspected.
