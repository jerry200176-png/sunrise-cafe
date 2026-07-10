# LINE OAuth Security Model

## Overview

LINE Login binds a verified `line_user_id` to reservations for payment notifications and reminders. Phase 3 hardens this against forgery and CSRF.

## Threat model

| Threat | Mitigation |
|--------|------------|
| Forged `line_user_id` in URL/body | **Removed** — userId only in signed httpOnly cookie |
| CSRF on OAuth callback | HMAC-signed `state` with expiry + nonce |
| Replay of OAuth state | 10-minute TTL; single-use flow |
| Stolen bind cookie | HMAC signature; 24h expiry; `Secure` in production |
| Invalid LINE user ID format | Regex `^U[0-9a-f]{32}$` on bind |

## Flow

```
1. User clicks「用 LINE 登入」
   → GET /api/auth/line/authorize?mode=prebooking
   → Server creates signed state, redirects to LINE

2. LINE redirects to /api/auth/line/callback?code=...&state=...
   → Verify state HMAC + expiry
   → Exchange code for access_token (server-side)
   → Fetch profile.userId from LINE API
   → Set httpOnly cookie line_bind_session=<signed payload>
   → Redirect to /book?line_bound=1 (NO userId in URL)

3. POST /api/reservations
   → Read line_user_id from cookie via getLineUserIdFromRequest()
   → Fallback: copy from prior reservation with same phone
   → Never read line_user_id from request body
```

## Post-booking bind (success page)

```
GET /api/auth/line/authorize?mode=post_booking&code=ABC123
→ state includes booking_code
→ callback updates reservations.line_user_id for matching phone
→ sets bind cookie
```

## Secrets

Uses `SESSION_SECRET` (preferred) or `ADMIN_PASSWORD` via `getSessionSecret()`.

**Production:** Set independent `SESSION_SECRET` in Vercel.

## Cookies

| Cookie | Flags | TTL |
|--------|-------|-----|
| `line_bind_session` | HttpOnly, SameSite=Lax, Secure (prod) | 24h |

## What clients must NOT do

- Pass `line_user_id` in API request bodies
- Put `line_user_id` in redirect URLs
- Use unsigned `state=prebooking` (legacy — removed)

## Rollback

Revert to URL-param binding only if cookie approach breaks — not recommended.

## Related

- `src/lib/line-oauth.ts`
- `src/app/api/auth/line/authorize/route.ts`
- `src/app/api/auth/line/callback/route.ts`
- ADR-001 (dual bot architecture)
