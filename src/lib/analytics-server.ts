import { createClient } from "@supabase/supabase-js";
import {
  type AnalyticsEventName,
  type AnalyticsProperties,
  isAnalyticsEventName,
  sanitizeAnalyticsProperties,
} from "@/lib/analytics-events";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export function isAnalyticsConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export type RecordAnalyticsInput = {
  event_name: AnalyticsEventName;
  session_id?: string | null;
  branch_id?: string | null;
  room_id?: string | null;
  properties?: AnalyticsProperties;
};

/**
 * Persist analytics event. Fails silently if table missing (migration not applied).
 */
export async function recordAnalyticsEvent(input: RecordAnalyticsInput): Promise<void> {
  if (!isAnalyticsConfigured()) return;

  const event_name = input.event_name;
  if (!isAnalyticsEventName(event_name)) return;

  const properties = sanitizeAnalyticsProperties(input.properties);

  try {
    const { error } = await supabaseAdmin().from("analytics_events").insert({
      event_name,
      session_id: input.session_id ?? null,
      branch_id: input.branch_id ?? null,
      room_id: input.room_id ?? null,
      properties,
    });
    if (error) {
      // Table may not exist until migration applied
      console.warn("[analytics] insert failed:", error.message);
    }
  } catch (err) {
    console.warn("[analytics] record error:", err);
  }
}

export type AnalyticsSummary = {
  days: number;
  funnel: {
    booking_started: number;
    room_selected: number;
    slot_selected: number;
    booking_completed: number;
    booking_failed: number;
  };
  waitlist: {
    cta_clicked: number;
    joined: number;
    conversion_rate: number | null;
  };
  cancellations: number;
  reschedules: number;
  cancellation_rate: number | null;
  peak_hours: { hour: number; count: number }[];
  by_branch: { branch_id: string; booking_completed: number }[];
};

export async function fetchAnalyticsSummary(days: number): Promise<AnalyticsSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin()
    .from("analytics_events")
    .select("event_name, branch_id, properties, created_at")
    .gte("created_at", since);

  if (error) throw error;

  const rows = data ?? [];
  const count = (name: string) => rows.filter((r) => r.event_name === name).length;

  const booking_started = count("booking_started");
  const booking_completed = count("booking_completed");
  const waitlist_cta = count("waitlist_cta_clicked");
  const waitlist_joined = count("waitlist_joined");
  const booking_cancelled = count("booking_cancelled");

  const hourCounts = new Map<number, number>();
  for (const row of rows) {
    if (row.event_name !== "booking_completed" && row.event_name !== "slot_selected") continue;
    const h = new Date(
      new Date(row.created_at).toLocaleString("en-US", { timeZone: "Asia/Taipei" })
    ).getHours();
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
  }

  const branchCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.event_name !== "booking_completed" || !row.branch_id) continue;
    branchCounts.set(row.branch_id, (branchCounts.get(row.branch_id) ?? 0) + 1);
  }

  return {
    days,
    funnel: {
      booking_started,
      room_selected: count("room_selected"),
      slot_selected: count("slot_selected"),
      booking_completed,
      booking_failed: count("booking_failed"),
    },
    waitlist: {
      cta_clicked: waitlist_cta,
      joined: waitlist_joined,
      conversion_rate: waitlist_cta > 0 ? waitlist_joined / waitlist_cta : null,
    },
    cancellations: booking_cancelled,
    reschedules: count("reschedule_completed"),
    cancellation_rate:
      booking_completed > 0 ? booking_cancelled / booking_completed : null,
    peak_hours: [...hourCounts.entries()]
      .map(([hour, c]) => ({ hour, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    by_branch: [...branchCounts.entries()].map(([branch_id, booking_completed]) => ({
      branch_id,
      booking_completed,
    })),
  };
}
