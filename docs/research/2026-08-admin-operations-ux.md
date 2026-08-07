# Sunrise admin operations UX research — 2026-08-01

## Problem and scope

The Sunrise admin already contains the core operating data: today's bookings,
deposit risk, payment review, waitlist, reminder delivery, and a room timeline.
The main gap is prioritisation and state communication. A staff member should
be able to answer, in one screen: what needs attention now, what is healthy,
and what action is safe to take next.

This slice is intentionally limited to the admin dashboard. It does not change
booking rules, payment state, database schema, or production credentials.

## References read

### Shopify Polaris (mature company practice)

- [Index table](https://polaris-react.shopify.com/components/tables/index-table)
- [Filters](https://polaris-react.shopify.com/components/selection-and-input/filters)
- [Design principles](https://polaris-react.shopify.com/design)

The implementation guidance is concrete: identify the resource, surface status
and numeric values clearly, use loading/empty states, provide sorting/filtering
for long lists, and keep actions close to the resource they affect. The filter
guidance also requires labelled controls, visible applied state, keyboard
completion, and no more than a few promoted filters.

### Filament (starred repository, actual table implementation guidance)

- [Empty-state source documentation](https://github.com/filamentphp/filament/blob/4.x/packages/tables/docs/08-empty-state.md)
- [Filter source documentation](https://github.com/filamentphp/filament/blob/4.x/packages/tables/docs/03-filters/01-overview.md)
- [Action source documentation](https://github.com/filamentphp/filament/blob/4.x/packages/tables/docs/04-actions.md)

Filament treats an empty table as an intentional state with a heading,
description, icon, and optional next action. Filters can be defaulted,
persisted, applied live or deferred, and reset explicitly. Record and bulk
actions are kept with the data they operate on and destructive actions require
confirmation.

### Chatwoot (starred repository, actual dashboard components)

- [ReportMetricCard.vue](https://github.com/chatwoot/chatwoot/blob/develop/app/javascript/dashboard/routes/dashboard/settings/reports/components/ReportMetricCard.vue)
- [CsatEmptyState.vue](https://github.com/chatwoot/chatwoot/blob/develop/app/javascript/dashboard/routes/dashboard/settings/reports/components/CsatEmptyState.vue)
- [OverviewReportFilters.vue](https://github.com/chatwoot/chatwoot/blob/develop/app/javascript/dashboard/routes/dashboard/settings/reports/components/OverviewReportFilters.vue)

The metric component keeps label, value, and explanatory information visually
compact. The empty state uses a quiet icon container, a specific title, and an
optional explanation. The report filter writes its date range and toggle into
the URL, restores them on load, and emits a single filter-change contract.

## Adoption hypotheses

1. Promote the dashboard's branch/date controls into a labelled filter bar
   with a one-tap “今天” reset and explicit timezone copy.
2. Add a compact “先處理” rail before charts so unpaid deposits, attendance
   confirmations, and un-sent reminders are visible before secondary metrics.
3. Use one reusable admin empty state for no-data views instead of generic
   text, while preserving the Sunrise warm visual language.
4. Keep the current payment review keyboard shortcuts; they already match the
   high-throughput operator pattern and should not be replaced by decoration.

## Deliberate non-adoption

- No new UI framework or design-system dependency: the current Next.js,
  Tailwind, and lucide stack is sufficient.
- No generic admin-template rewrite: the cafe's mobile floor-ops navigation and
  warm visual identity remain product-specific.
- No bulk payment mutation: payment approval/rejection stays explicit and
  auditable.

## Verification

- `npm run lint`
- `npm run typecheck`
- `npm run typecheck:baseline`
- `npm test`
- `npm run build`
- `npm run design:audit`
- `npm run verify:production-workflow`
- production `/api/version` SHA and `/api/booking-health` after deployment
