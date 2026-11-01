# Held production code-only REST release

The current migration-first workflow can replay historical SQL during a code
release. The proposed REST workflow creates a Vercel deployment from the exact
Git commit without invoking a migration runner or sending SQL. The product diff
includes unpaid-booking retention, quiet group reminders, disabling cold-start
migration probes, and tightening the existing booking-health endpoint. Normal application requests, cron handlers,
rate-limiting and telemetry can still write; this is not a claim of zero writes.
The existing migration-first workflow and both jobs of the new workflow start
with a hard stop. The Python entrypoint and platform network switches also stop
before credential access. Nothing here deploys or changes production.

## Intended sequence

1. Check out `main`, match the runtime SHA and caller-supplied reviewed tree,
   then use GitHub's rules and PR association APIs to require strict rules,
   green required checks on the exact merged PR head, and an identical merged
   tree. Verify that the current production alias identifies a READY deployment
   in this project, that Vercel lists it as a rollback candidate and that its
   version/homepage/booking health responds; then persist a run/attempt-bound
   intent. Recheck the baseline immediately before the create request. Candidate
   listing does not prove the token is authorized to perform rollback.
   The independent D3 review is recorded separately; tree input alone proves
   neither CI nor review.
2. Upload the intent, check artifact receipt, then retrieve and verify its
   metadata, run ID, name, commit, digest and bounded ZIP content before a
   single create request. A fixed, exclusive runner-local claim prevents a
   repeat while that claim remains; it does not fence another or restarted runner.
3. Create the production Git-source deployment, check project/repository/ref/
   commit metadata, persist and upload its candidate ID. This can serve real
   production traffic before verification completes.
4. Recheck both remote artifacts and deployment identity, then poll boundedly
   for READY and alias assignment before checking `/api/version` commit, a
   non-empty HTML homepage, and the public `/api/booking-health` result. The
   latter requires an active branch and an array result from `get_blocked_slots`;
   confirm the actual database target and RPC side effects before enabling it.
   A healthy response does not verify a booking or payment transaction. The monitor
   also polls boundedly for a delayed alias;
   expiry remains unknown because the provider request might still complete.
   Polling passes the remaining deadline to each Vercel/health request; the
   preceding artifact verification has its own per-request deadlines and
   rollback has a separate bounded recovery window.
   These reads do not verify the booking or payment flow. Existing version output has no deployment ID;
   the Vercel alias API supplies that identity separately. Repeat the alias check
   after the health responses. The routes can consume an Upstash rate-limit
   bucket and, when limited, may write an ops record.
5. If health fails and the live alias still identifies this candidate, request
   rollback to the recorded baseline, then recheck alias and health. A separate
   job can repeat recovery from verified same-run artifacts. The checks and
   rollback are not atomic; a third-party writer can race between them.

A timeout on create can leave a request in flight. The request carries its run,
attempt and commit as Vercel metadata. On an unknown create outcome the workflow
does not repeat POST: it reads all bounded pages filtered by project, target,
branch and SHA, requires exactly one matching run/attempt/commit marker, and
rechecks the deployment's project, target, repository, ref, SHA and metadata.
If found, it saves only a separately named untrusted observation for manual
investigation and still reports unknown. It is never uploaded as trusted
candidate evidence and cannot authorize automatic rollback. Zero or multiple matches, inaccessible or
incomplete pages, and identity mismatches remain unknown. Provider list results
may be eventually consistent; the marker is not signed or an atomic lock.
If the runner dies before candidate upload, the later monitor cannot attribute
an alias to this request; it reports unknown. A still-building
candidate remains unknown even after a rollback. `always()` and a seven-day
artifact do not guarantee a recovery job will survive cancellation, runner or
platform failure. The hard stop must remain until a real D7 recovery path and
the existing D8 stop-line are independently resolved. Operator fallback, when
a valid baseline is known, is Vercel project → Deployments → select the
previous production deployment → Instant Rollback, followed immediately by
alias and health verification. See [Vercel rollback](https://vercel.com/docs/deployments/rollback-production-deployment).

## Configuration and access to verify without displaying values

- A prior read-only TinyFish repository-settings snapshot listed the names
  `VERCEL_TOKEN`, `SUPABASE_DB_URL`, `BACKUP_AGE_RECIPIENT` and
  `NEXT_PUBLIC_SUPABASE_URL`. The snapshot did not expose values, establish that
  they are nonempty, or prove which environment a job receives. In particular,
  the existing `VERCEL_TOKEN` still needs actual authorization to read the
  project, deployments and alias, create a production Git deployment, and roll
  back. Do not print its value or create a replacement as part of this check.
- That repository-secret snapshot did not list `CRON_SECRET`; organization or
  environment secrets were not ruled out. A separate Vercel Production snapshot
  did list the `CRON_SECRET` name. Neither snapshot proves the value is nonempty
  or that GitHub and Vercel values match, and no values were examined.
- The Actions-provided `GITHUB_TOKEN`: `contents: read` for checkout/rules,
  `checks: read`, `statuses: read` and `pull-requests: read` for exact-head
  checks/PR association, and `actions: read` for same-run artifacts. Whether job
  outputs and artifact retrieval remain available after cancellation needs an
  actual platform-supported verification.
- Repository variable `GITHUB_ARTIFACT_ALLOWED_HOSTS`: an independently approved
  comma-separated exact host allowlist for GitHub's short-lived artifact archive
  redirects. It is currently unverified; an empty or mismatched value fails
  closed. GitHub credentials are sent only to `api.github.com`, never to these
  archive hosts. HTTPS, redirect rejection, byte caps and a worker deadline were
  checked using local synthetic HTTP/HTTPS only.
- Vercel project/GitHub integration: same intended repository, `main` ref and
  reviewed commit; production environment and the existing live alias must
  resolve to the intended deployment and data target. The exact `gitSource`
  response shape and source/build provenance remain unverified. The API can
  build immediately and assign domains; a Git preview is not treated as the
  same build or environment as production.
- A read-only connector response for the current baseline identified the
  production deployment and reported `source: cli` with commit metadata, but
  did not expose `gitSource` despite requesting Git details. The `source` label
  is a best-effort provider field, and CLI-supplied metadata is self-reported;
  neither establishes the baseline's exact source. For D7, the known current
  deployment ID can still be treated as the operational rollback target after
  project/READY/alias, rollback-candidate and health checks. When Git source is
  unavailable, the baseline probe checks that version output is well formed
  without treating the self-reported commit as independently verified source.
  A provider Git source is still not a signed build attestation. The connector normalizes
  responses, so absence there is not proof that the raw API can never return it.
- Production DB and REST target identity, cron configuration, previous worker
  drain and rollback compatibility require independent evidence. The earlier
  isolated PostgreSQL restore alone does not prove complete Supabase recovery.
- Required checks must be green on the final merged head and final code must
  receive independent review. The API gate fails closed for missing/ambiguous
  strict rules, incomplete check pages, wrong head or different merged trees;
  it does not independently establish reviewer identity. At inspection the
  read-only rules endpoint returned Lint & Build, Playwright smoke and Agent
  Session Provenance as strict required contexts. Network and prerequisite
  constants remain disabled until the existing stop-line is resolved in a
  separately reviewed change.

The [Vercel create API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment),
[deployment metadata API](https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url)
and [rollback API](https://vercel.com/docs/rest-api/projects/point-production-traffic-to-a-previous-production-deployment-by-id)
are used as the contract. Tests use synthetic transports and local servers;
none establish that a real token, artifact redirect, deployment, or rollback works.
