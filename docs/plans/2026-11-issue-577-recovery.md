# Code-only release: proven pre-create failure

## Problem and scope

On run 42343038814, `prepare` failed and GitHub recorded `create` as skipped. The separate recovery job nevertheless tried to download a baseline that had never been uploaded, producing a second failure. This change addresses the classification of this attempt's own phases, not earlier attempts, the original release failure, other deployment writers, or production identity. The release must remain failed. No database or business behavior changes.

## Root cause

The release job communicates candidate identity but not whether its prepare and create steps actually completed. Recovery runs after every failed release and assumes an uploaded baseline exists. This conflates a proven pre-create refusal with an attempted or indeterminate create. It also makes a phase proof necessary: a missing job output is not proof that a step was skipped, and an interrupted runner may not produce any output.

## Reference practices

- GitHub Actions [step outcome and job contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#steps-context) and [job outputs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idoutputs): pass explicit outcomes; outputs may be absent and are evaluated on the runner at job completion. [Cancellation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation) may leave external work in flight; do not simply replace recovery's `always()` with `!cancelled()`.
- Open-source [actions/runner v2.338.2, MIT](https://github.com/actions/runner/blob/d1eb12d4b115c301201de27d667284e1a80f2ab5/src/Runner.Worker/JobExtension.cs#L802) omits empty or secret-like job outputs; its [step tests](https://github.com/actions/runner/blob/d1eb12d4b115c301201de27d667284e1a80f2ab5/src/Test/L0/Worker/StepsRunnerL0.cs#L563) distinguish outcome, conclusion and skipped steps. Do not infer safety from missing evidence or copy runner internals.
- [Argo Rollouts v1.10.2 (Apache-2.0)](https://github.com/argoproj/argo-rollouts/blob/be8a6221c6c9751cd14497f31a2cb3c33690375a/rollout/analysis_test.go#L1603) keeps a failed rollout degraded even when traffic returns to stable. Apply the distinction between this release failing and the state of the service; do not introduce the tool or copy its implementation.
- Existing project recovery and artifact canary already verify candidate ownership and retained identity. Reuse them; do not introduce another production deploy or recovery mechanism.

## Proposed contract

Export explicit step outcomes from the release job. A failed release is classified as this attempt's proven pre-create failure only when `create=skipped` and either `prepare=failure` plus `baseline-upload=skipped`, or `prepare=success` plus `baseline-upload=failure`. In that case recovery emits a clear diagnostic: no create or rollback was performed by this attempt; release remains failed and global production state and earlier attempts are not inferred. All other combinations, including absent outputs, cancellation, runner loss, a create outcome other than skipped, verify failure, or inconsistent evidence, retain the existing recovery path and its fail-closed behavior.

The proposal deliberately does not infer a pre-create failure from a missing artifact or a failed job alone. The current recovered baseline and candidate evidence remain bound to the run and attempt.

## Verification and stop points

Use synthetic phase combinations, the existing artifact/ownership tests and a no-secret GitHub Actions canary for real cross-job outcome propagation. Check the unmodified unknown/cancel paths, original release failure, skipped-create proof and that unrelated writer state is not claimed. Required CI and independent exact-head review remain mandatory. No production dispatch, real data, credential change, or deploy is authorized by this design; obtain the user's explicit release approval and satisfy existing recovery controls before deployment.
