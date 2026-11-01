# Release safety integration — still blocked

The current workflow can repeat migration runners before and after deployment;
two jobs called `verify` execute those runners again. It also treats some failed
or skipped deploy attempts as success. That permits database writes without a
retained encrypted recovery point, or after a different version is serving.

This local candidate combines the fixed heads of #503 and #528. The conflict in
the postdeploy environment retains **both** the backup artifact digest and the
expected deployment ID. All four executable phases require an encrypted upload;
the existing preflight and postdeploy fences deliberately refuse execution. The
write-capable postdeploy verification job also has an explicit first-step stop,
so it remains blocked even if the earlier job is changed independently. Both
postdeploy write steps independently require the observed commit and deployment
ID to match immediately before the runner; observation is not a writer lock.
All four backup jobs require the same explicit `SUPABASE_DB_URL` job secret for
their respective backup and migration steps. The workflow no longer pulls or
reads production environment files; the secret is injected into only the three
steps that need it in each job. A missing or invalid value stops the job without
printing it. The `CRON_SECRET` verification step similarly requires the explicit
GitHub secret; it no longer fetches an environment file. It remains unknown
whether the current production GitHub secrets are provisioned correctly. The
change does not establish that the artifact can be decrypted, that its digest is
the database's current state, or that a Vercel alias is exclusively writable by
this workflow. Artifact upload evidence is not an independent recovery drill.

**Do not merge, deploy or remove the hard stops.** Writer fencing and a D7-safe
recovery path are unresolved, and previous production/backup identity is not
proven by these tests. The two requested customer changes contain no migration
files themselves, but the current main workflow still invokes historical
migrations on a push. Runtime workers, source identity, schema compatibility,
provider behavior, stored secret ownership and point-in-time recovery remain
unverified. A failed CI job is not a rollback mechanism. A future code-only path
must establish and independently review those controls rather than skipping them.

## References

- [GitHub Actions dependencies](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds): failed prerequisites stop dependent jobs.
- [GitHub upload-artifact](https://github.com/actions/upload-artifact/tree/v4.6.2) (MIT): artifact ID and digest are upload evidence, not decryptability.
- [Argo CD sync phases](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/) (Apache-2.0): post-sync work follows successful, healthy deployment. No code is copied.
