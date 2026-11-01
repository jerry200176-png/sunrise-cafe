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
would compare the clean `main` checkout with the fixed deployed baseline, the
entire tree of the exact CI-passing and independently reviewed PR head supplied
at dispatch, and a manifest of exact contents from #542/#543 plus the
bootstrap/version changes. Other paths are rejected except the explicitly
reviewed release infrastructure. The caller-supplied tree SHA is not itself
proof of CI or review: the operator must independently verify the exact head,
its tree, CI and D3 review before dispatch. This is an integrity check, not proof
that application code never writes data.
The GitHub-hosted runner installs the pinned CLI with lifecycle scripts disabled
before receiving the token. The adapter checks project, alias, baseline SHA and
rollback candidacy; it stages with `--prod --skip-domain`, verifies deployment
ID, checks selected changed runtime source files via the Vercel file API, checks
the runtime's self-reported SHA and HTTP GET smoke responses, promotes, observes production, and
checks runtime for 15 minutes. It invokes no database migration commands. These
GETs do not provide credentials and fail closed if deployment protection prevents
access; the implementation does not call `vercel curl`, which may create a
deployment-protection bypass credential. A GET to `/api/version` passes through
the general API rate limiter and may update an Upstash counter; if limited, the
existing middleware may also write an ops event. The adapter spaces watch requests
30 seconds apart and stops on a non-200 response; this reduces request frequency
but does not prove that counters, logs or other telemetry are unaffected.
The selected-source check is not a full source-tree comparison or build-output
attestation. The CLI-supplied runtime SHA is a self-reported value, not independent
proof of the uploaded commit or built artifact. File API shape, permissions, and
availability for the new deployment have not been verified; any discrepancy or
unavailable source fails closed. Independent full provenance remains unresolved.

On observed failed or unknown production health it immediately attempts a
specified rollback to the prior deployment if the alias still points to its own
candidate, then checks the prior alias/SHA and smoke. A changed alias, failed or
unknown platform command, failed rollback or unconfirmed health is an incident
requiring immediate documented operator response; no blind retry is attempted.
Before investigating any error after production-target staging has started, the
adapter writes a restricted incident record, even if no deployment ID is known.
The workflow attempts to upload that record and create or update a same-repository
incident issue on step failure. If staging, promotion or rollback has an
unknown outcome, the adapter observes the alias for a bounded period, attempts
rollback at most once after observing its own candidate, and reports the outcome
as unknown even if the baseline is currently healthy. A late platform operation
can still finish after that observation window. Artifact upload and issue creation
occur after the step finishes and can themselves fail; abrupt runner cancellation
can prevent both, so a separate active operator/monitor is still required.
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
The npm registry's latest stable CLI was 65.9.0 when this lock was prepared;
`npm audit --package-lock-only` reported 23 high and one critical transitive
findings. A no-force, package-lock-only `npm audit fix --ignore-scripts` in an
isolated copy left those counts unchanged. The suggested 53.2.0 alternative
reported 31 high and one critical in a separately generated lock. These are audit
findings, not proof of exploitability of this particular command path. The
dedicated CI job audits the locked release CLI before any credentialed use; no
blind major-version overrides or downgrade are accepted as a fix.
Vercel's [Cron deployment documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-jobs-and-deployments) states that existing running jobs continue during a new deployment, but does not establish that a `--prod --skip-domain` deployment cannot register or receive cron invocations before promotion. Cron behavior for this exact staging mode is therefore unverified, and old in-flight workers are not drained. The hard stop must remain while these prerequisites are unknown. No real LINE,
production database, deployment, promotion or rollback was called in this work.

## References

- [Vercel deployment CLI](https://vercel.com/docs/cli/deploy): `--prod --skip-domain` stages without automatic domain assignment; `--env` and `--build-env` set per-deployment values.
- [Vercel promotion](https://vercel.com/docs/deployments/promoting-a-deployment): promote a production build without rebuilding; [rollback](https://vercel.com/docs/instant-rollback) restores a previous deployment rather than its database.
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) serializes a same-group repository workflow, not all external deployment writers.
- [Argo Rollouts](https://github.com/argoproj/argo-rollouts), Apache-2.0, informs stage, verify and rollback ordering; no code or dependency is copied.
