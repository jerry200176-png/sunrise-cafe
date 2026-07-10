# Security Maturity Review — Phase 6

**Date:** 2026-07-10  
**Scope:** Authentication, authorization, secrets, dependencies, API abuse, privacy  
**Baseline:** Post Phase 5 (`cursor/phase6-platform-governance-3a90`)

---

## Summary

| Area | Maturity | Trend |
|------|----------|-------|
| Authentication | B | Guest phone+code; LINE httpOnly binding |
| Authorization | C+ | Admin session solid; catalog APIs gap (P0) |
| Secrets handling | B+ | gitleaks CI; env docs; no committed secrets |
| Dependency vulnerabilities | B− | `npm audit` continue-on-error in CI |
| API abuse prevention | B | Upstash rate limits; fail-open documented |
| Privacy compliance | B+ | Analytics allowlist; masked retention APIs |

**Overall:** Suitable for trusted-operator commercial use. **Close P0 catalog auth** before franchise scale or public adversarial exposure.

---

## Authentication Flows

| Flow | Implementation | Status |
|------|----------------|--------|
| Admin login | `ADMIN_PASSWORD` + HMAC session (`SESSION_SECRET`) | ✅ |
| Admin API | `requireAdminApiAuth` + middleware | ✅ |
| Guest lookup/cancel | `phone` + `booking_code` (`guest-auth.ts`) | ✅ (post P1-1) |
| LINE OAuth | Signed state + httpOnly `line_user_id` cookie | ✅ |
| Cron jobs | `Bearer CRON_SECRET` or admin session | ✅ |

**Gaps:**
- No MFA for admin
- No per-operator accounts
- Session rotation on password change requires `SESSION_SECRET` (documented)

---

## Authorization Boundaries

| Endpoint class | Expected guard | Verified |
|----------------|----------------|----------|
| `/api/admin/*` | Admin session | ✅ |
| Guest mutate (cancel/reschedule) | phone + booking_code | ✅ |
| `POST /api/reservations` | Public create; server sets price/status | ⚠️ verify server-side enforcement |
| `POST/PATCH/DELETE /api/branches` | **Should require admin** | ❌ P0 — track in debt register |
| `POST/PATCH/DELETE /api/rooms` | **Should require admin** | ❌ P0 |
| `POST /api/reservations/recurring` | **Should require admin** | ❌ P0 |
| `/api/diagnose` | Should be admin-only or removed | ❌ P0 |
| `/api/analytics` | Public ingest; allowlisted props | ✅ |
| `/api/experiments/active` | Public; no PII | ✅ |

---

## Secrets Handling

| Practice | Status |
|----------|--------|
| `.env.local` gitignored | ✅ |
| Service role key server-only | ✅ |
| LINE tokens in Vercel env | ✅ |
| `CRON_SECRET` for scheduled jobs | ✅ |
| gitleaks in CI | ✅ |
| Placeholder env in CI build | ✅ |

**Recommendations:**
- Set distinct `SESSION_SECRET` in production
- Rotate LINE tokens on channel migration (documented in `CLAUDE.md`)
- Enable Upstash in production (remove fail-open for public APIs)

---

## Dependency Vulnerabilities

| Control | Status |
|---------|--------|
| `npm audit` in CI | ⚠️ `continue-on-error: true` |
| Dependabot weekly | ✅ |
| Next.js 15.1.9 pinned | ✅ |

**Action:** Quarterly dependency review; tighten CI when high CVEs cleared.

---

## API Abuse Prevention

| Vector | Mitigation | Gap |
|--------|------------|-----|
| Brute-force admin login | 5/min rate limit | ✅ |
| Booking spam | 5/min per IP | ✅ |
| Guest lookup enumeration | 10/min + booking_code | ✅ |
| Analytics flood | 60/min general API | ⚠️ no per-event cap |
| Webhook replay | LINE signature HMAC | ✅ |
| Cron invocation | `CRON_SECRET` | ✅ if set |

**Production requirement:** Document that `UPSTASH_*` should be set before high-traffic launch.

---

## Privacy Compliance

| Data | Handling | Status |
|------|----------|--------|
| Analytics | No PII; allowlist in `analytics-events.ts` | ✅ |
| Customer insights | Aggregates only | ✅ |
| Retention APIs | Masked phones | ✅ |
| Payment screenshots | `payment_events`; admin-only RLS | ✅ |
| LINE user IDs | Stored for service delivery; not in analytics | ✅ |
| Data retention | Analytics 24mo purge (Phase 6) | ✅ |

**Taiwan PDPA / GDPR-style:** No formal DPA doc; operational minimum-collection principle documented in Phase 5/6 architecture.

---

## Remediation Tracker

| ID | Finding | Severity | Phase 6 action |
|----|---------|----------|----------------|
| SEC-6-1 | Unauthenticated branch/room mutations | P0 | Document; fix in dedicated security PR |
| SEC-6-2 | `npm audit` non-blocking | P1 | Track quarterly |
| SEC-6-3 | Rate limit fail-open | P1 | Production checklist update |
| SEC-6-4 | No admin RBAC | P2 | `MULTI_BRANCH_SCALE.md` |
| SEC-6-5 | Global `closed_dates` | P2 | Per-branch future migration |

---

## Sign-off Checklist Update

See updated items in `docs/SECURITY_REVIEW_CHECKLIST.md` (Phase 6 section).

| Role | Date | Notes |
|------|------|-------|
| Engineer | 2026-07-10 | Phase 6 automated review |
| Operator | | |

---

## Related

- `docs/ENGINEERING_ASSESSMENT.md` — original P0 register
- `docs/SECURITY_REVIEW_CHECKLIST.md`
- `docs/LINE_OAUTH_SECURITY.md`
