# AI Agent Development Governance

Rules for **multiple AI agents** (Cursor Cloud, Copilot, Claude, etc.) contributing safely to Sunrise Cafe.

---

## Required Reading Order

Before any non-trivial change, read in order:

1. **`CLAUDE.md`** — stack, LINE dual-channel, timezone traps, cron schedule
2. **`docs/PLATFORM_GOVERNANCE.md`** — domain boundaries and dependency rules
3. **`docs/DECISIONS.md`** — ADRs (especially payment, LINE, timezone)
4. **Domain doc** for your task:
   - Booking → `docs/PRICING.md`, `slot-conflict` patterns
   - Payments → `docs/PAYMENT_STATE_MODEL.md`
   - LINE → `docs/LINE.md`, `docs/LINE_OAUTH_SECURITY.md`
   - Analytics → `docs/ANALYTICS.md`
   - DB → `docs/DATABASE_EVOLUTION.md`, `docs/DATA_DICTIONARY.md`
5. **`docs/TECHNICAL_DEBT_REVIEW.md`** — do not re-introduce closed issues

---

## Files Agents Must NOT Modify Blindly

| Path | Risk | Required before edit |
|------|------|----------------------|
| `supabase/schema.sql` | **Destructive DROP** | Human approval; never apply to prod |
| `src/middleware.ts` | Auth bypass | Security review + test admin/guest paths |
| `src/lib/admin-auth.ts`, `admin-api-auth.ts` | Session security | Run `admin-api-auth.test.ts` |
| `src/lib/guest-auth.ts` | IDOR | Run `guest-auth.test.ts` |
| `src/lib/line-oauth.ts` | Account binding | Read `LINE_OAUTH_SECURITY.md` |
| `src/app/api/webhooks/line/route.ts` | Payment false-positives | Payment + keyword tests |
| `src/lib/deposit-deadline.ts` | Auto-cancel | Run deposit tests |
| `vercel.json` crons | Wrong local time | Convert UTC ↔ Asia/Taipei |
| `.env*` / Vercel secrets | Credential leak | Never commit values |
| `migration-*.sql` without manifest | Schema drift | Run `npm run sync:migrations` |

---

## Testing Requirements

Before opening a PR, agents **must**:

```bash
npm test                    # Unit tests (required)
npm run verify:migrations   # Manifest ↔ filesystem (required)
npm run lint                # ESLint (required)
npm run build               # With CI placeholder env (required)
```

Optional but recommended for UI/API changes:
```bash
npm run test:e2e            # Playwright smoke
```

**Minimum test additions** when changing:
- Business logic in `src/lib/` → unit test in `*.test.ts`
- Auth changes → extend `admin-api-auth.test.ts` or `guest-auth.test.ts`
- Analytics allowlist → `analytics-events.test.ts`

---

## Migration Safety Rules

1. **One concern per migration file** when possible.
2. **Idempotent SQL:** `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`.
3. **Always** append `INSERT INTO schema_migrations`.
4. **Register** in `migrations.manifest.json` via `npm run sync:migrations`.
5. **Never** assume migration ran in production — code must degrade gracefully (Phase 5 pattern: `migration_required` flags).
6. **RLS:** New tables with PII or payment data → enable RLS; block anon.

---

## PR / Review Checklist (Agent Self-Review)

- [ ] Scope minimal — no unrelated refactors
- [ ] Matches existing naming and import style
- [ ] Taipei timezone used for display (`toTaipei` / `datetime.ts`)
- [ ] LINE: correct channel token (group vs customer bot)
- [ ] No PII in analytics properties
- [ ] Admin routes use `requireAdminApiAuth`
- [ ] Cron routes verify `CRON_SECRET` or admin
- [ ] `CHANGELOG.md` updated for user-visible changes
- [ ] `docs/MIGRATIONS.md` updated if new SQL files
- [ ] No secrets in diff

---

## Multi-Agent Coordination

| Situation | Rule |
|-----------|------|
| Two agents, same domain | One branch per agent; rebase on latest `main` |
| Overlapping migrations | **Stop** — human merges one migration first |
| Conflicting ADRs | Follow `DECISIONS.md`; propose new ADR for changes |
| Unclear ownership | Default DRI: Platform engineer per `PLATFORM_GOVERNANCE.md` |

---

## Forbidden Without Human Approval

- Changing payment auto-mark behavior (keywords / screenshot flow)
- Removing or weakening rate limits
- Disabling LINE webhook signature verification
- Broad `anon` RLS policies
- Dynamic pricing or overbooking features
- Bulk export endpoints for guest PII

---

## Related

- `CLAUDE.md` — operator handbook
- `docs/SECURITY_REVIEW_CHECKLIST.md`
- `docs/ONBOARDING.md` — human developer setup
