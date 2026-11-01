# Gate postdeploy migrations on confirmed production version

## Problem and root cause

The production workflow runs predeploy migrations and verification before its deploy job, then starts postdeploy migrations as soon as that job reports success. The job currently succeeds when the deploy token is absent and turns a failed deployment into a warning. Additionally, `deploy.sh` reports a quota rejection with exit status zero. Consequently postdeploy DDL can run while production still serves an older version. A job conclusion is not evidence that the intended code is serving traffic.

## Approach

Check the production `/api/version` response against the exact checked-out SHA before allowing a no-op or allowing postdeploy. If not already current, require the existing deploy token, run the existing single deploy attempt, and independently check the exact SHA again. After backup and setup, repeat the version check immediately before the postdeploy runner. Missing/malformed response, timeout, command failure or mismatch stops the relevant job. This confirms the responding endpoint only; it does not prove all regions, configuration, database identity or migrations are safe. External deployment writers are not locked: they can still change production between the last check and the DDL, so atomic deployment identity / writer coordination remains a blocker.

The current version endpoint exposes only commit SHA, not deployment identity. `force_deploy=true` is used for configuration activation and a matching SHA cannot prove a fresh deployment took effect. A preflight job rejects it **before predeploy** until a separately reviewed deployment-identity check exists. This intentionally pauses the existing force-activation workflows. Docs-only SHA drift is also not sufficient for postdeploy and may stop the pipeline. No automatic retry, new service, database operation, migration change or production environment access is added. Normal predeploy operations remain outside the scope of this gate and still need their own protections.

If a deployment was attempted but the final check or command failed, it may have reached users. Run the runtime watch after any non-skipped deploy job, including failed or cancelled jobs, without depending on job outputs that may be lost. On a failed or cancelled job, report runtime failure but do not automatically roll back: the deployed identity is unknown. Workflow-wide cancellation or runner failure can still prevent the watch, requiring manual monitoring.

The existing success-path automatic rollback is now limited to jobs that actually attempted a deployment, but matching SHA does not distinguish another deployment of the same commit. This pre-existing identity ambiguity remains a blocker: before this candidate can be deployed, design and independently verify an immutable deployment-identity check or an approved alternative to automatic rollback. The stop-the-line release hold and recovery-point requirements remain in force.

## References

- [GitHub Actions job dependencies](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds): a failed dependency skips dependent jobs unless an explicit condition overrides it.
- [Argo CD sync phases](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/) and [Apache-2.0 license](https://github.com/argoproj/argo-cd/blob/master/LICENSE): PostSync follows successful sync and healthy resources; use the ordering principle, not the product or code.
- [GitLab post-deployment migrations](https://docs.gitlab.com/development/database/post_deployment_migrations/): schema transitions must respect the deployed application version. Existing Sunrise scripts remain the implementation.

Tests run the actual workflow shell with fake commands and isolated temporary paths, never a live deployment, alongside structural checks for the job graph and watch. Those structural checks do not execute GitHub Actions' actual failure or cancellation semantics. Full CI, independent review and the existing release hold remain required.
