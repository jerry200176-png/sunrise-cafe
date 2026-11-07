/**
 * Shared HMAC key for guest-facing tokens (lookup + attendance).
 * 1. `GUEST_LOOKUP_SECRET`  2. `SESSION_SECRET`
 * 3. Non-production only: a fixed dev string.
 * Production without 1 or 2 throws. `ADMIN_PASSWORD` / `CRON_SECRET` are never used:
 * as HMAC keys they could be brute-forced offline from any guest token.
 * NEVER reuse `SUPABASE_SERVICE_ROLE_KEY` here.
 */
export class LookupSigningUnavailableError extends Error {
  constructor() {
    super("Guest token signing is not configured (set GUEST_LOOKUP_SECRET or SESSION_SECRET)");
    this.name = "LookupSigningUnavailableError";
  }
}

export function getGuestTokenSecret(): string {
  const configured =
    process.env.GUEST_LOOKUP_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new LookupSigningUnavailableError();
  return "sunrise-guest-lookup-dev-secret";
}

/** Boolean-only check for callers that must stop before any DB write or notification. */
export function isLookupSigningConfigured(): boolean {
  try {
    getGuestTokenSecret();
    return true;
  } catch {
    return false;
  }
}
