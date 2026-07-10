# Architecture Overview

**Sunrise Cafe** · Multi-branch booking + ordering platform

## System context

```
Guests (Web) ──► Vercel (Next.js 15 App Router)
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
    Supabase      LINE APIs    Upstash/Sentry
    PostgreSQL    (2 channels)  (optional)
```

## Key modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Booking UI | `src/app/book/` | Guest reservation wizard |
| Admin | `src/app/admin/` | Ops, insights, payments |
| APIs | `src/app/api/` | REST endpoints |
| Analytics | `src/lib/analytics*.ts` | Event pipeline |
| BI / KPIs | `src/lib/business-kpis.ts` | Revenue, occupancy, funnel |
| Auth | `src/lib/admin-api-auth.ts`, `guest-auth.ts`, `line-oauth.ts` | Admin, guest, LINE |
| Automation | `src/lib/deposit-deadline.ts`, `waitlist.ts` | Crons + triggers |

## Data stores

- **reservations** — source of truth for bookings & revenue
- **analytics_events** — funnel (no PII)
- **waitlist** — demand recovery
- **payment_events** — deposit audit trail
- **branches / rooms / settings** — configuration

## Security boundaries

- Public: availability, reservation POST, analytics ingest
- Guest-auth: lookup, cancel, reschedule (`phone` + `booking_code`)
- Admin-session: all `/api/admin/*` except login
- Cron-secret: scheduled jobs

## Deployment

- **Production:** Vercel (`main` branch)
- **CI:** GitHub Actions — lint, unit test, build, Playwright E2E
- **Migrations:** Manual Supabase SQL (`docs/MIGRATIONS.md`)

## Related docs

- `docs/PHASE4_ARCHITECTURE.md` — growth roadmap
- `docs/BUSINESS_INTELLIGENCE.md` — KPI definitions
- `docs/LINE_OAUTH_SECURITY.md` — LINE binding
- `docs/RELEASE.md` — deploy checklist
- `CLAUDE.md` — operator handbook
