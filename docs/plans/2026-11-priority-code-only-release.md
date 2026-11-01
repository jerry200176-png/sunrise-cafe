# Priority code-only release — hard stop retained

The two reviewed priority changes retain unpaid reservations and reduce empty
group reminder messages. A normal main push still executes historic database
migration runners, including `verify` jobs which write. This one-use candidate
adds an explicitly selected staged deployment path without calling those
runners. Historical cold-start DDL/claim probes are disabled using #535's
reviewed no-op and tests. This is **not** a claim that the application, GET
requests, Redis rate limits, logging, telemetry, or other running workers have no
side effects. Pre-existing production workers can still perform old behavior.

## Mandatory stop and proof obligations

Both the old migration path and this code-only path have unconditional first-step
stops. **Do not remove those stops until the existing D8 condition has been
independently assessed and resolved.** The stopped workflow is not a production
deployment. In particular, establish the actual migration/backup target and
recovery scope, release and rollback permissions, remaining worker/cron behavior,
and database compatibility without executing historical SQL. `--check` merely
validates a local migration plan and does not prove production schema state.
An age-decrypted `public` backup does not by itself establish full Supabase
Auth/Storage restoration or current secret compatibility. Existing incident and
security candidates remain independently tracked.

If those prerequisites are genuinely resolved, the reviewed one-use dispatch
would compare the clean `main` checkout with the fixed deployed baseline and a
manifest of exact contents from #542/#543 plus the bootstrap/version changes;
other paths are rejected except the explicitly reviewed release infrastructure.
This is an integrity check, not proof that application code never writes data.
The GitHub-hosted runner installs the pinned CLI with lifecycle scripts disabled
before receiving the token. The adapter checks project, alias, baseline SHA and
rollback candidacy; it stages with `--prod --skip-domain`, verifies deployment
ID/SHA and read-only HTTP smoke responses, promotes, observes production, and
checks runtime for 15 minutes. It invokes no database migration commands.

On observed failed or unknown production health it immediately attempts a
specified rollback to the prior deployment if the alias still points to its own
candidate, then checks the prior alias/SHA and smoke. A changed alias, failed or
unknown platform command, failed rollback or unconfirmed health is an incident
requiring immediate documented operator response; no blind retry is attempted.
Vercel rollback may reinstate prior environment and cron settings; it does not
undo database changes. The previous deployment's configuration, behavior and
compatibility therefore must be reviewed before the stage. This program does not
create an independently staffed incident response or guarantee an immediate
rollback after a runner cancellation, process crash, or platform outage.

The concurrency group serializes this workflow and other workflows using that
same repository group; it cannot fence an independent Vercel console, token or
integration. The check immediately before promote or rollback cannot prevent a
competing writer from winning in the following interval. We have not observed a
competing writer in the latest read-only snapshot, but cannot prove that none can
act. Production alias/version observations also do not prove all regions or
rolling traffic have converged. These limitations must be evaluated against the
actual release and rollback controls; CAS is not a stated RULEBOOK D7 requirement.

This candidate has only fake-provider/local Git tests. Local installation of the
pinned Vercel CLI failed for lack of workspace disk; actual CLI options,
protected staging access, current Vercel permissions, rollback availability and
the complete GitHub workflow have **not** been verified against the platform.
The hard stop must remain while these prerequisites are unknown. No real LINE,
production database, deployment, promotion or rollback was called in this work.

## References

- [Vercel deployment CLI](https://vercel.com/docs/cli/deploy): `--prod --skip-domain` stages without automatic domain assignment; `--env` and `--build-env` set per-deployment values.
- [Vercel promotion](https://vercel.com/docs/deployments/promoting-a-deployment): promote a production build without rebuilding; [rollback](https://vercel.com/docs/instant-rollback) restores a previous deployment rather than its database.
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) serializes a same-group repository workflow, not all external deployment writers.
- [Argo Rollouts](https://github.com/argoproj/argo-rollouts), Apache-2.0, informs stage, verify and rollback ordering; no code or dependency is copied.
