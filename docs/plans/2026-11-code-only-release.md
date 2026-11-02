# Code-only production release

Unpaid reservations must remain booked and the group bot should not send an
empty reminder. Both changes are application-only. The current deployment
workflow replays historical database migrations before and after every deploy;
it can run postdeploy SQL even if deployment did not finish. That coupling is
the cause of the release block. This candidate pauses the legacy migration job
and introduces a separate code-only deployment path. It does not execute
migrations; future database changes require their own reviewed path. The
existing Verify Production workflow runs as a required child of this release:
its migration drift check uses PostgREST GETs and a catalog SELECT, not
migration execution. Its failure triggers the same recovery job.

On a protected `main` push, the workflow verifies the required checks on the
merged PR head and verifies that its tree equals the checked-out merge tree.
It records and uploads the current production deployment ID and version before
one Git-source create request. A one-use manifest rejects any unreviewed file,
including migrations and schema changes; a later release needs a separately
reviewed baseline and manifest. It verifies the new deployment, `/api/version`,
the home page and `/api/booking-health`, then preserves the existing 15-minute
runtime watch. The watch also sends the existing unauthenticated PATCH to a
fixed synthetic reservation ID and expects HTTP 401; this is a real HTTP
request and may touch rate limiting or logging, not an entirely read-only probe.
A separate recovery job downloads the baseline record and tries
to restore that deployment after a failure. It will not roll back an unrelated
deployment. A known in-flight candidate can be cancelled; an unknown result is
reported as unknown rather than retried or claimed successful.

## Reference practices

- [Vercel Create Deployment](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)
  supports Git source and a precise commit SHA; the
  [rollback API](https://vercel.com/docs/rest-api/projects/point-production-traffic-to-a-previous-production-deployment-by-id)
  selects the recorded prior deployment.
- [Google SRE release engineering](https://sre.google/sre-book/release-engineering/)
  separates repeatable release processes from database migrations and makes
  rollback and release identity explicit. No external code was copied.

## Operational limits

- Production deployment creation serves traffic when ready; unlike a staged
  production build, health verification occurs immediately after traffic moves.
  Preview and production would be different builds/environments, so a preview
  would not prove the production build.
- GitHub Actions must have the existing `VERCEL_TOKEN` with deployment and
  rollback rights; a missing or rejected token fails before a successful
  release. Listing deployments does not prove write rights.
- The site and Git source, production database schema and RPCs, prior workers,
  and real notification delivery are not established by synthetic tests. The
  health probes do not create reservations or payments and cannot prove those
  flows end to end.
- Migration drift diagnostics use `limit=0` for column and table existence
  probes to avoid transferring customer rows. An isolated PostgREST 12.2.12
  and PostgreSQL 17 test returned 200 for an existing column and 42703 for a
  missing column; production's exact server version has not been verified.
- A create request whose response is lost is never repeated. Recovery watches
  the alias for a bounded period and rolls back only the exact deployment ID
  retained from the create response as a commit-bound job output or artifact.
  Conflicting records are rejected. A matching source SHA alone cannot prove
  ownership; a missing candidate ID requires immediate manual investigation.
  When the candidate ID is known, recovery attempts to
  cancel an in-progress build. Vercel documents a maximum build time of
  [45 minutes](https://vercel.com/docs/builds); an unknown create is observed
  for 50 minutes, but a build queue can add time. A Vercel request may complete
  after that period, or the
  runner/recovery job may itself fail. These cases remain **unknown** and must
  be inspected immediately; they are not a verified rollback. Where Vercel's
  deployment response does not expose the expected Git source fields, an
  unrecorded candidate cannot be safely identified by metadata alone.
- If automated recovery fails or is interrupted, use the documented
  [Vercel rollback procedure](https://vercel.com/docs/deployments/rollback-production-deployment)
  immediately to restore the prior production deployment recorded in the
  `code-only-baseline-<run>-<attempt>` artifact; then verify alias and health.
  This restores application code only and does not reverse database writes.
- Alias checks and a subsequent rollback are not atomic. An independent writer
  can race them; the code refuses to replace an observed unrelated deployment.
  Repository concurrency serializes this workflow only.
