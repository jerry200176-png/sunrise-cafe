/** Domain facade — product analytics */
export { trackEvent, getAnalyticsSessionId } from "@/lib/analytics";
export { recordAnalyticsEvent, fetchAnalyticsSummary } from "@/lib/analytics-server";
export type { AnalyticsEventName, AnalyticsProperties } from "@/lib/analytics-events";
