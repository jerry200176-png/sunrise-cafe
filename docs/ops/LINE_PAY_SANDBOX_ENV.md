# LINE Pay Vercel sandbox env

Production LINE Pay keys live in Vercel, not GitHub. This allowlisted workflow inspects names/presence and may set only:

`LINE_PAY_API_BASE_URL=https://sandbox-api-pay.line.me`

It never prints `LINE_PAY_CHANNEL_ID` or `LINE_PAY_CHANNEL_SECRET` values, never writes those keys, and never runs a payment test.

If channel keys are absent, Founder must add **sandbox** keys from LINE Pay Merchant Center before any sandbox transaction. Do not point live keys at the sandbox host and call that a successful test.
