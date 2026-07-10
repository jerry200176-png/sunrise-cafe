# Business Intelligence — KPI Definitions

**Phase 4** · Admin APIs: `GET /api/admin/bi/summary`, `GET /api/admin/customers/insights`

## Core KPIs

| KPI | Definition | Source |
|-----|------------|--------|
| **Booking conversion rate** | `booking_completed ÷ booking_started` | `analytics_events` |
| **Occupancy rate** | `Σ booked hours ÷ Σ available room-hours` | `reservations` + branch hours |
| **RevPAR (room-hour)** | `revenue ÷ available room-hours` | `reservations.total_price` |
| **Cancellation rate** | `cancelled ÷ all reservations in period` | `reservations.status` |
| **No-show rate (estimated)** | Past-start `pending/confirmed` without check-in ÷ expected arrivals | `reservations` + grace window |
| **Customer return rate** | Phones with ≥2 bookings ÷ unique phones | `reservations.phone` (admin only) |
| **Waitlist recovery** | `waitlist.status=booked ÷ total joined` | `waitlist` |

## UI

- **商業洞察** `/admin/insights` — unified dashboard
- **營收報表** `/admin/reports` — monthly revenue charts (legacy, complementary)

## Privacy

- Analytics events: no PII
- Customer insights: aggregates + masked phone samples only
- Full guest details: reservation admin list only

## Implementation

Pure functions: `src/lib/business-kpis.ts`
