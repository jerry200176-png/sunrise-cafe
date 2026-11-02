# LINE Pay Vercel sandbox env

The legacy LINE Pay environment workflow and script are temporarily paused for all modes, including read-only inspection. Running either reports that it is paused; it does not read credentials, inspect or change Vercel settings, or deploy.

This pause does not change the existing production configuration or customer payment flow. To restore diagnostics or configuration changes, first complete the reviewed credential, output, activation, and recovery checks in `docs/plans/2026-11-linepay-ci-isolation.md`.

Do not use live merchant credentials for a sandbox transaction or treat a configuration change alone as a successful payment test.
