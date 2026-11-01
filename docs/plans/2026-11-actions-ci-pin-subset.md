# GitHub Actions: CI-only subset of #489

## Problem and scope

The grouped #489 update spans CI, production deployment, encrypted backups,
and a Vercel environment workflow. A green PR test cannot establish safety of
the Vercel CLI/API integration, credential handling, deployment, or backup
recovery. Prepare only the exact official checkout, setup-node, and gitleaks
pins from #489 in the existing CI and dependency-review workflows. Their
triggers, steps, permissions, caching, inputs, secrets, and assertions are not
changed. No production deployment, backup, secret, or environment workflow is
modified. The upload-artifact upgrade is deliberately deferred: in this repo it
also handles recovery-point artifacts and needs independent compatibility and
restore evidence. This does not resolve the grouped update or the release hold.

## 參考做法

- [actions/checkout v7.0.1](https://github.com/actions/checkout/tree/v7.0.1) (MIT)
  uses Node 24 and restricts unsafe fork checkout for privileged events;
  its runner requirement and credential storage differ from v4.
- [actions/setup-node v7.1.0](https://github.com/actions/setup-node/tree/v7.1.0) (MIT)
  documents runner v2.327.1+, npm cache behavior, and removed auth fallback.
  Existing jobs explicitly request npm caching and use no registry-url input.
- [gitleaks-action v3.0.0](https://github.com/gitleaks/gitleaks-action/tree/v3.0.0)
  documents Node 24, runner v2.327.1+, and personal-account versus organization
  licensing. Its [license is an EULA](https://github.com/gitleaks/gitleaks-action/blob/v3.0.0/LICENSE.txt),
  not MIT; no source is copied. Public repository metadata identifies the owner
  as a user account, but licensing remains governed by the upstream terms.
- Root cause: a grouped dependency bump combines low-risk CI pins with
  production integrations that need different evidence; separating workflows
  lets each be reviewed without representing a partial update as full validation.

Official Git tag refs were read on 2026-11-01 and match the full pinned SHA.
The old #489 exact head `8109dacd6876119c35f4e91862169be1b53a158a` had GitHub
CI Lint & Build and Playwright smoke pass with these versions; its simulated
LINE Pay PR job also passed without a production operation. That prior run is
not CI evidence for this candidate, does not test all event types, and does not
validate a real Vercel CLI, API, credentials, backup or restoration.

Before use, exact-head GitHub CI and independent review are required. The
existing release hold continues; do not merge or deploy while it remains.
Rollback is a revert of this CI-only change, subject to the existing dependency
runtime and security requirements; no production data or secret is touched.
