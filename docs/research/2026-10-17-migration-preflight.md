# Bounded migration verification preparation

Base: PR #468 `af4942fb40f7fec3043b7e25f52d08278b4a9133`.
This is a local standalone preflight proposal. PR #468 remains on release hold.
It supersedes the local phase-dispatch proposal `21a8494`; do not integrate that
proposal, which deliberately blocked 21 runner contracts.

## Deliverable and boundary

`scripts/verify-bank-transfer-reports.mjs` invokes the existing exported bank-transfer
readiness checks inside `sql.begin("read only", ...)`. Importing its application
module no longer starts `main`. It does not apply SQL, repair ACLs, invoke claim
RPCs, or catch readiness failures and continue to application. Deployment workflow,
phase runner, migration plan, runtime bootstrap and booking behavior are unchanged.
The existing application path retains its ACL repair operation; it is deliberately
not a valid read-only readiness command.

PUBLIC execute is checked with `aclexplode` (PUBLIC grantee OID zero), including
PostgreSQL default function ACLs when `proacl` is null. Role privilege fields must
be strictly true/false as expected; missing/null fields fail. Existing relation,
column, index-name, function-signature and version checks are retained. These
checks do not prove every column/index/function definition matches source.
An idempotent ACL regrant alone does not establish privilege expansion.

No CLI invocation of this preflight is authorized by this handoff. Its eventual
execution requires the separately authorized database readiness package. Tests
use only synthetic query doubles; no SQL engine or production data is involved.

## Minimal complete path evaluated

The canonical plan has 22 unique executable runners (11 predeploy, 11 postdeploy).
Reusing their existing checks requires ordinary function exports/entrypoint guards,
not a new migration framework. However, extraction alone does not prove readiness:

| Existing runners | Reusable check | Remaining unknown / work |
| --- | --- | --- |
| bank-transfer-reports | Catalog schema/signatures, effective role privileges, ledger | Standalone proposal complete; detailed definition parity remains unproven |
| reservation-preorder, booking-meals | Existing catalog validators | Export preorder verifier; preserve existing limitations and PUBLIC handling; test import and read-only execution |
| preorder-menu-seed, branch-guest-settings, branch-weekly-hours, reservations-deposit-transfer-info, branches-archive, line-deliveries, menu-option-sets, no-show-advice | Existing SELECT readiness functions | Export functions without apply; preserve prerequisites/version checks normally performed by apply; test each failure. Seed reads aggregate data, not just catalog. Some checks prove presence only |
| ops-events, payment-request-sent, line-pay-safety, reservation-message-actions, reservation-message-batch, deposit-approved-notified, deposit-approved-claim, deposit-approved-retry-key, market-parity | Existing REST GET table/column probes | Extract GET-only checks and fail on auth/transport/missing configuration; current runners sometimes skip successfully. GET readability does not prove indexes, privileges or definitions |
| line-reminder-deliveries | Table GET plus mutating claim RPC | Retain GET; replace claim invocation with reviewed catalog signature/ACL check. Catalog cannot establish PostgREST cache visibility by itself |
| line-guest-notification-deliveries | Table GET and version markers for lifecycle/guard/retry migrations | Need catalog definition/trigger/ACL evidence for behavior changes; markers alone are insufficient |

Runtime bootstrap is outside these 22 plan runners and must be inventoried before
any release authorization. Settlement SQL remains excluded. No existing gate is
removed or weakened, and this standalone command is not wired into deployment.

## Evidence and dependency diagnosis

- Four focused suites pass: bank preflight, production migration plan, reminder
  paging, and no-auto-cancel (44 tests total, including 15 preflight tests).
- Preflight tests cover valid catalog, missing relations/columns/indexes/functions/
  ledger, public/anon/service privilege drift, absent/null privilege fields,
  transaction boundary and error propagation. Importing the real module in tests
  does not connect or execute application.
- These are synthetic tests, not a PostgreSQL integration test or live readiness
  result. A read-only transaction's database enforcement is not simulated proof
  that the deployed database is ready.
- package-lock.json and package.json both declare @react-three/fiber 9.8.1,
  @react-three/drei 10.7.9, three 0.185.1, @types/three 0.185.0. All four are absent
  from the shared node_modules used here. This explains the missing module errors
  and related JSX/implicit-any cascade in RoomFloorScene.tsx. No dependency or
  unrelated app changes were made. A clean install from the unchanged lockfile
  is the next local setup step; it is not a production prerequisite claim.

## Remaining effort and decisions

The small standalone proposal is ready for source review; it is not a complete
migration readiness gate and does not authorize release. A complete integration
would touch roughly 21 more runner boundaries plus focused tests, replace one
claim-RPC probe, establish guest-notification catalog evidence, and inventory
runtime bootstrap. Estimated remaining local work: 4–8 engineering hours plus
independent review, depending on definition parity gaps; no database access is
included in that estimate. Keeping deployment unchanged is the bounded option
while AllTrue remains priority.

No scope question is required to continue the existing read-only preparation.
Before publishing or wiring a reviewed patch into release, confirm the exact
integration delta. Production preflight and any pending mutation require their
own scoped execution/recovery evidence; no release GO follows from local tests.
