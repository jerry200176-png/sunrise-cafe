# Production identity observations must not imply release readiness

## Root cause and reuse

`scripts/production-identity.sh` already collects the public runtime SHA, a health response and GitHub workflow metadata. It reports GREEN whenever its small list of explicit failures is empty, although it explicitly says the database migration state is unknown; a missing verification run and shortened SHA are also accepted. Thus a successful process exit is stronger than its evidence. There is no provider-side target-project, deployment provenance, writer fence, migration-ledger, regional convergence or rollback proof in these observations.

This candidate keeps the existing collector and makes the evaluator independently testable. A known contradiction is RED, incomplete evidence is UNKNOWN and only fully verified evidence may eventually support GREEN. The current collector cannot produce that evidence, so it deliberately never reports GREEN. UNKNOWN and RED have different nonzero exits. The collector retrieves the health response and HTTP status together in one request instead of the previous two; no new production read or write is added. A successful health observation only reports one responding endpoint, and verification metadata does not authenticate the target database or fence concurrent deployments.

## Reference approach

- [Google SRE monitoring](https://sre.google/sre-book/monitoring-distributed-systems/) distinguishes the quality of signals and alerts; missing observations are not a health guarantee.
- [GitHub Actions job states and conclusions](https://docs.github.com/en/rest/actions/workflow-runs) distinguish an absent/in-progress run from a completed success. The exact commit must match; an earlier successful run is not evidence for a later commit.
- [Argo CD health assessment](https://argo-cd.readthedocs.io/en/stable/operator-manual/health/) ([Apache-2.0](https://github.com/argoproj/argo-cd/blob/master/LICENSE)) distinguishes Unknown from Healthy; adopt the evidence classification, not the implementation.

## Constraints

No migration, deployment, provider configuration, database, rollback or credential change. Existing release freeze and checks remain. Consumers must handle UNKNOWN rather than treating any non-RED state as green. Unit tests use synthetic in-memory metadata only. The collector's health endpoint can itself call the backend and is not proven side-effect-free; this work does not execute it. Cross-origin or mutable provider evidence is not converted into a proof or authorization by this report.
