# Analytics — Sunrise Cafe

## Overview

Sunrise Cafe uses a **privacy-first, first-party analytics** pipeline. Events are stored in Supabase (`analytics_events`) and aggregated for the admin dashboard. No third-party trackers; no PII.

## What we track

### Customer journey events

| Event | Trigger | Properties (no PII) |
|-------|---------|---------------------|
| `landing_viewed` | Home page mount | `locale` |
| `booking_started` | `/book` page load | `branch_id` (if single-branch skip) |
| `room_selected` | User picks room | `branch_id`, `room_id` |
| `slot_selected` | User picks time slot | `branch_id`, `room_id`, `duration_hours` |
| `booking_completed` | `POST /api/reservations` success | `branch_id`, `room_id`, `duration_hours` |
| `booking_failed` | Reservation POST error | `error_code`, `room_id` |
| `waitlist_cta_clicked` | Waitlist CTA click | `branch_id`, `room_id`, `source` |
| `waitlist_joined` | `POST /api/waitlist` success | `branch_id`, `room_id` |
| `booking_cancelled` | Guest cancel success | `branch_id` |
| `reschedule_completed` | Guest reschedule success | `branch_id`, `room_id` |

### Business metrics (derived)

Available via `GET /api/admin/analytics/summary?days=7`:

| Metric | Formula |
|--------|---------|
| Booking conversion rate | `booking_completed / booking_started` |
| Abandonment | Funnel drop-off per step |
| Waitlist conversion | `waitlist_joined / waitlist_cta_clicked` |
| Cancellation rate | `booking_cancelled / booking_completed` |
| Peak booking hours | Histogram from `slot_selected` / `booking_completed` |
| Branch performance | Events grouped by `branch_id` |

### Not yet tracked (future)

- **No-show rate** — requires `checked_in` vs `confirmed` operational data entry
- Requires staff to mark no-shows in admin

## Privacy rules

**Never stored:**

- Phone numbers, names, emails
- Booking codes
- LINE user IDs
- IP addresses (only used ephemerally for rate limiting)

**Allowed:**

- Anonymous `session_id` (UUID in `sessionStorage`, per browser tab session)
- UUIDs: `branch_id`, `room_id`
- Numeric: `duration_hours`, HTTP-style `error_code`
- Enum strings: `source`, `locale`, `step`

## Client usage

```typescript
import { trackEvent } from "@/lib/analytics";

trackEvent("room_selected", { branch_id: branchId, room_id: roomId });
```

Events are fire-and-forget; failures do not block UX.

## Server usage

```typescript
import { recordAnalyticsEvent } from "@/lib/analytics-server";

await recordAnalyticsEvent({
  event_name: "booking_completed",
  branch_id: room.branch_id,
  room_id: roomId,
  properties: { duration_hours: 3 },
});
```

## Database

Migration: `supabase/migration-analytics-events.sql`

Apply after `migration-schema-versions.sql`.

## Admin dashboard

`/admin/dashboard` includes an **營運洞察** section when analytics data exists.

## Future: external BI

Export query:

```sql
SELECT event_name, date_trunc('day', created_at AT TIME ZONE 'Asia/Taipei') AS day, count(*)
FROM analytics_events
WHERE created_at > now() - interval '30 days'
GROUP BY 1, 2
ORDER BY 2, 1;
```
