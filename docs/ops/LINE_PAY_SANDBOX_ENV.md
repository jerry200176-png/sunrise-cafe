# LINE Pay Vercel sandbox env

Production LINE Pay keys live in Vercel, not GitHub. This allowlisted workflow inspects names/presence and may set only:

`LINE_PAY_API_BASE_URL=https://sandbox-api-pay.line.me`

It never prints `LINE_PAY_CHANNEL_ID` or `LINE_PAY_CHANNEL_SECRET` values, never writes those keys, and never runs a payment test.

`restore-fixed-link` removes those names plus `LINE_PAY_API_BASE_URL` from Production/Preview so guests fall back to the branch's fixed LINE Pay URL. Use this when the live merchant is QR-only and has no Online API keys.

If channel keys are absent, Founder must add **sandbox** keys from LINE Pay Merchant Center before any sandbox transaction. Do not point live keys at the sandbox host and call that a successful test.

Pull requests run isolated tests using fake values and a fake Vercel CLI; they do not inspect or change the actual Vercel environment. Run the workflow manually on `main` in `inspect` mode when real environment evidence is needed. That manual check continues to require Vercel access and fails if it cannot inspect the environment.
