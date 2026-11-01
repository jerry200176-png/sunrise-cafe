# Gate postdeploy migrations on confirmed production version

## Problem and root cause

The production workflow runs predeploy migrations and verification before its deploy job, then starts postdeploy migrations as soon as that job reports success. The job currently succeeds when the deploy token is absent and turns a failed deployment into a warning. Additionally, `deploy.sh` reports a quota rejection with exit status zero. Consequently postdeploy DDL can run while production still serves an older version. A job conclusion is not evidence that the intended code is serving traffic.

## Approach

**Draft only — normal release blocked.** Vercel documents `VERCEL_DEPLOYMENT_ID` as the immutable ID of a deployment. Expose this non-secret ID in `/api/version`; observe it together with the commit SHA and stop the watch when the observed ID changes, even if the commit does not. Missing or malformed identity is unknown, not a match. An observed ID does not establish that the deployment was created by this workflow: CLI stdout URL / Vercel deployment metadata and production alias would need separate verified binding, and one HTTP sample cannot establish regional convergence or rolling-release configuration.

No documented compare-and-swap for Vercel promotion or rollback has been found. A GET immediately before a write cannot prevent another writer from changing the deployment afterward. Accordingly this candidate deliberately blocks **all postdeploy runner execution before touching the database**, and replaces blind automatic rollback with an incident and the immediate manual procedure below. This reduces automation and interrupts normal release; it is not a claim that D7 is satisfied. Do not merge or deploy until an independently reviewed, enforceable single-writer / atomic-fencing design and an operational D7-compliant recovery path are in place, alongside existing backup and release gates.

### Immediate manual response for a failed or unknown verification

1. Keep the release freeze. A responsible operator immediately compares the production domain and Vercel deployment ID, project/team, rollout/region status and active change owners using trusted Vercel interfaces. Treat unavailable or changing evidence as unknown; do not guess and do not retry a timed-out rollback blindly.
2. Identify and independently verify the last known healthy deployment ID and its compatibility with the current database, configuration and cron schedules. Vercel rollback can restore old environment and cron settings; it does not roll back the database.
3. After confirming no conflicting writer, the authorized operator immediately follows `docs/RUNBOOK.md` rollback and checks the served deployment ID, expected version and runtime health. If those conditions or D7's immediate recovery cannot be met, escalate and maintain the freeze; do not declare D7 complete.

[Vercel deployment system variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_deployment_id), [alias API](https://vercel.com/docs/rest-api/aliases/get-an-alias), [alias assignment](https://vercel.com/docs/rest-api/aliases/assign-an-alias), [rolling releases](https://vercel.com/docs/rolling-releases), and [instant rollback](https://vercel.com/docs/instant-rollback) describe the observable identity and limits. No provider endpoint was called in this work.

Check the production `/api/version` response against the exact checked-out SHA and an observed deployment ID. If not already current, require the existing deploy token, run the existing single deploy attempt, and independently check the identity again. Missing/malformed response, timeout, command failure or mismatch stops the relevant job. Even a matching identity cannot authorize postdeploy writes without an enforceable writer fence. This confirms the responding endpoint only; it does not prove all regions, configuration, database identity or migrations are safe.

The current version endpoint exposes only commit SHA, not deployment identity. `force_deploy=true` is used for configuration activation and a matching SHA cannot prove a fresh deployment took effect. A preflight job rejects it **before predeploy** until a separately reviewed deployment-identity check exists. This intentionally pauses the existing force-activation workflows. Docs-only SHA drift is also not sufficient for postdeploy and may stop the pipeline. No automatic retry, new service, database operation, migration change or production environment access is added. Normal predeploy operations remain outside the scope of this gate and still need their own protections.

If a deployment was attempted but the final check or command failed, it may have reached users. Run the runtime watch after any non-skipped deploy job, including failed or cancelled jobs, without depending on job outputs that may be lost. Unknown identity causes an incident rather than a guess. Workflow-wide cancellation or runner failure can still prevent the watch, requiring manual monitoring.

Automatic rollback is disabled in this draft because a sampled identity cannot safely fence other writers; the manual response above does not itself establish that D7 will be met. The stop-the-line release hold and recovery-point requirements remain in force.

## References

- [GitHub Actions job dependencies](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds): a failed dependency skips dependent jobs unless an explicit condition overrides it.
- [Argo CD sync phases](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/) and [Apache-2.0 license](https://github.com/argoproj/argo-cd/blob/master/LICENSE): PostSync follows successful sync and healthy resources; use the ordering principle, not the product or code.
- [GitLab post-deployment migrations](https://docs.gitlab.com/development/database/post_deployment_migrations/): schema transitions must respect the deployed application version. Existing Sunrise scripts remain the implementation.

Tests run the actual workflow shell with fake commands and isolated temporary paths, never a live deployment, alongside structural checks for the job graph and watch. Those structural checks do not execute GitHub Actions' actual failure or cancellation semantics. Full CI, independent review and the existing release hold remain required.
