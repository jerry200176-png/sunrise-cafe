/**
 * Analytics event names — single source of truth.
 * See docs/ANALYTICS.md
 */
export const ANALYTICS_EVENTS = [
  "landing_viewed",
  "booking_started",
  "room_selected",
  "slot_selected",
  "booking_completed",
  "booking_failed",
  "waitlist_cta_clicked",
  "waitlist_joined",
  "booking_cancelled",
  "reschedule_completed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** Property keys allowed in analytics payloads (no PII) */
export const ANALYTICS_PROPERTY_KEYS = [
  "locale",
  "branch_id",
  "room_id",
  "duration_hours",
  "error_code",
  "source",
  "step",
] as const;

export type AnalyticsPropertyKey = (typeof ANALYTICS_PROPERTY_KEYS)[number];

export type AnalyticsProperties = Partial<
  Record<AnalyticsPropertyKey, string | number>
>;

export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

export function sanitizeAnalyticsProperties(
  input: Record<string, unknown> | undefined
): AnalyticsProperties {
  if (!input) return {};
  const out: AnalyticsProperties = {};
  for (const key of ANALYTICS_PROPERTY_KEYS) {
    const val = input[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "string" || typeof val === "number") {
      out[key] = val;
    }
  }
  return out;
}
