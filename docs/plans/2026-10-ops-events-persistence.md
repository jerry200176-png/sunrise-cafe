# #486: Make ops_events persistence failures observable

## Symptom and root cause

The application emits a structured console event, then starts an unawaited
`persistOpsEvent(...).catch(() => {})`. Some PostgREST errors mentioning
`ops_events` are treated as success. Missing credentials, missing schema, rejected
inserts, and timeouts therefore look alike in the admin metrics: no durable row and
no actionable failure signal. In a serverless request, an unawaited promise also
does not by itself prove the write finishes before the invocation is frozen.

Five whys: operators cannot see a historical event (symptom); the insert may never
complete or errors are swallowed; persistence is explicitly detached from the
request lifecycle and errors are filtered by message text; the helper treats table
not-ready and any operation involving the table as an optional feature; no contract
tests exercise these failure modes.

## Correct behavior

Keep the business operation and response independent of telemetry storage. Schedule
the insert through a request-lifecycle hook supported by the runtime; report a
bounded, structured warning to the existing function log on failure, with only
fixed reason codes and the existing domain/action enums. The request aborts after
three seconds. A timeout is reported as an unknown outcome because the database may
have committed before the response was lost; never retry automatically. Do not
include the error message, event detail, identifiers, or credentials. Preserve the
PostgREST HTTP status alongside its error code: transport status `0`, generic
network rejection, and server errors have unknown outcomes; only explicit
constraint/permission database codes or HTTP client rejection are classified as
rejected. Distinguish missing configuration, missing table, timeout with unknown
outcome, generic unknown outcome, and rejected insert. A missing table is an
observable deployment/configuration state, not a successful write.

## 參考做法

- 競品／大公司怎麼做：Google SRE monitoring guidance recommends actionable,
  low-noise signals tied to symptoms and clear ownership; use the existing Vercel
  function log as the signal and do not invent an external alert recipient
  (<https://sre.google/sre-book/monitoring-distributed-systems/>).
- 開源參考（含授權）：Next.js `after` (MIT) runs work after a response while
  extending the request lifecycle; Vercel's `waitUntil` has the equivalent
  lifecycle contract for middleware
  (<https://nextjs.org/docs/app/api-reference/functions/after>,
  <https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package>).
  Adopt lifecycle-aware scheduling; do not copy a vendor-specific alerting system.
- 根因 vs 症狀：detached/unobserved work and message-substring suppression are
  root causes; adding only another console message without scheduling or error
  classification would address the symptom.

## Reuse and boundaries

Reuse `logOps`, its existing structured console output, and the configured
Supabase client. Keep the feature independent of #60's general structured logging
and #471's LINE delivery isolation. No migration, external notification, retry,
production probe, or production data change is needed.

## Verification

Unit tests cover absent configuration, exact missing-table codes, rejected insert,
real abort-signal timeout behavior, real PostgREST network-reset behavior, success,
scheduler lifecycle, and redaction.
The unit harness does not create an actual Next request store or invoke a deployed
Vercel middleware lifecycle; `after()` registration and middleware `waitUntil` wiring
remain an integration limitation until a Next runtime test is run.
