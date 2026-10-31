# LINE Pay Vercel sandbox env

Production LINE Pay keys live in Vercel, not GitHub. This allowlisted workflow inspects names/presence and may set only:

`LINE_PAY_API_BASE_URL=https://sandbox-api-pay.line.me`

It never prints `LINE_PAY_CHANNEL_ID` or `LINE_PAY_CHANNEL_SECRET` values, never writes those keys, and never runs a payment test.

`restore-fixed-link` removes those names plus `LINE_PAY_API_BASE_URL` from Production/Preview so guests fall back to the branch's fixed LINE Pay URL. Use this when the live merchant is QR-only and has no Online API keys.

If channel keys are absent, Founder must add **sandbox** keys from LINE Pay Merchant Center before any sandbox transaction. Do not point live keys at the sandbox host and call that a successful test.

Pull requests run isolated tests using fake values and a fake Vercel CLI; they do not inspect or change the actual Vercel environment. Run the workflow manually on `main` in `inspect` mode when real environment evidence is needed. That manual check continues to require Vercel access and fails if it cannot inspect the environment.

Raw command output stays private. The workflow publishes only validated status fields, never the original output. If validation or the operation fails, it publishes no evidence. `set-sandbox-url` refuses to change an existing URL unless it already matches the sandbox URL exactly; a different or unreadable existing value must be investigated separately.

`restore-fixed-link` fails if an environment listing fails or if Production or Preview still lists any of the three LINE Pay variables afterward. The removals are separate Vercel operations: a failure may leave a partial change, requires manual investigation, and does not dispatch the deployment workflow.

**Operational blocker:** this workflow still invokes an unpinned Vercel CLI, and the CLI table provides no proof that the list is complete. Unknown table formats are rejected, but a recognized truncated table could still be incomplete. Do not run the real environment operations until the CLI and complete-list verification are independently resolved. A sandbox operation also refuses to proceed if either channel key is present, because its type cannot be established from its name.
