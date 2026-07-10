# Service Level Objectives (SLO)

**Sunrise Cafe booking platform** · Phase 4

## User-facing SLOs

| SLI | Target | Measurement |
|-----|--------|-------------|
| Booking page availability | 99.5% / 30d | Vercel uptime + synthetic `/book` check |
| API success rate (public) | 99% / 30d | 5xx rate on `/api/availability`, `/api/reservations` POST |
| Booking completion latency | p95 < 3s | Server-side reservation POST duration (Sentry) |

## Admin SLOs

| SLI | Target | Notes |
|-----|--------|-------|
| Admin login + dashboard | 99% / 30d | Session auth required |
| Cron reminder delivery | 95% / run | LINE API failures logged |

## Error budget

- **Monthly error budget** = 100% − SLO (e.g. 0.5% downtime ≈ 3.6h for 99.5%)
- When budget exhausted: freeze non-critical deploys; prioritize reliability
- Track via: Sentry issues, Vercel analytics, manual cron logs

## Review cadence

- Weekly: check Sentry new issues, failed cron logs
- Monthly: SLO review in `CHANGELOG` release notes
