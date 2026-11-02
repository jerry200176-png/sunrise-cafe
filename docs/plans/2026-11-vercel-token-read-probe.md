# Research: Vercel token read permission probe

Status: **local research branch only**. Do not merge this branch into main. The candidate intentionally disables the original predeploy job; dependent production jobs must stay skipped. Do not run or push it before independent review.

## Purpose and limitations

The current connector can read the live alias, but receives HTTP 403 when listing rollback candidates. The repository also has a `VERCEL_TOKEN` secret name; neither observation establishes whether the Actions token is the connector token or what access it has. The only way for a separate principal to demonstrate access is to authenticate as that principal. The proposed job sends the existing token directly to the fixed official Vercel HTTPS endpoint in one GET, does not print or store its value or response body, and reports only HTTP 200, HTTP 403, or unknown. A 200 confirms only that the project-filtered deployment-list endpoint responded successfully: it does not show that any candidate was returned, that the filter was honored, that deployment creation or rollback writes are permitted, or that a rollback will succeed. It does not change release freeze, target identity, database state, or recovery evidence.

## Safety boundaries

- Manual `workflow_dispatch` only, exact repository and research branch; the reviewed commit SHA must match `github.sha` before the secret-bearing step. There is no checkout, package installation, third-party action or repository script in the probe job. Its GitHub token permissions are empty.
- The existing production migration root job is unconditionally skipped on this research branch. Its dependent jobs, including the `always()` watch which requires a successful deployment, must remain skipped; independently verify the effective workflow DAG before any dispatch.
- This research branch uses its own `research-vercel-token-get-probe` concurrency group so dispatching it cannot replace or delay a queued run in the real `production-deploy-main` group.
- The job permits exactly one GET to a literal `https://api.vercel.com` URL with the known team and project IDs. Python runs isolated, clears inherited environment after extracting the token, ignores proxies, verifies TLS using the OS trust store, rejects redirects, does not read response bodies, and prints only fixed status text. It has a socket timeout and a GitHub job timeout. A proxy, error response, redirect, unavailable token, 429, other failure or unexpected status never implies authorization.
- This protects against third-party checkout/dependency code, **not** a malicious author changing the workflow itself. The workflow must be independently reviewed at the exact ref and SHA before any dispatch. The input is an integrity check, not an independently signed approval. Do not dispatch a ref whose identity cannot be verified.
- GitHub documents that the workflow file must exist on the default branch to manually dispatch, and that `--ref` selects a branch or tag. The existing workflow path exists on main. Whether the new branch-only dispatch input is accepted has not been verified; failure must not be worked around by dispatching main or running another job. No secret-scoped event has been dispatched during this research.

## References

- GitHub Actions manual dispatch and branch selection: <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow>.
- GitHub secure use: scope tokens and treat executable workflow content as trusted code: <https://docs.github.com/en/actions/reference/security/secure-use>.
- Vercel deployment list: <https://vercel.com/docs/rest-api/deployments/list-deployments>.
- Python `urllib.request` (Python Software Foundation License): <https://docs.python.org/3/library/urllib.request.html>. The probe uses the standard library, verified TLS and its own redirect refusal rather than adding an external dependency.

## Local validation

Run `python3 -B -m unittest tests/test_vercel_scope_probe.py`. Tests use only synthetic tokens and a fake opener: GET endpoint/headers, token omission, 403, redirect, timeout, TLS/proxy settings and branch/commit guards. They do not authenticate to Vercel, run GitHub Actions, or verify deploy or rollback permission.
