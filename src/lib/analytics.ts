"use client";

import type { AnalyticsEventName, AnalyticsProperties } from "@/lib/analytics-events";

const SESSION_KEY = "sc_analytics_session";

export function getAnalyticsSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

/**
 * Fire-and-forget client analytics. Never blocks UX; never sends PII.
 */
export function trackEvent(
  event_name: AnalyticsEventName,
  properties?: AnalyticsProperties
): void {
  if (typeof window === "undefined") return;

  const session_id = getAnalyticsSessionId();
  const body = JSON.stringify({
    event_name,
    session_id: session_id || undefined,
    branch_id: properties?.branch_id,
    room_id: properties?.room_id,
    properties,
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/analytics",
        new Blob([body], { type: "application/json" })
      );
      return;
    }
  } catch {
    /* fall through */
  }

  fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    /* silent */
  });
}
