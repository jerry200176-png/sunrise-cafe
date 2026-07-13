/**
 * OPS-004b — aggregate persisted ops_events into funnel KPIs.
 */
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { calcConversionRate } from "@/lib/outcome-metrics";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type FunnelMetrics = {
  ops_events_ready: boolean;
  booking_flow_entered_7d: number;
  booking_created_7d: number;
  booking_conversion_pct: number | null;
  deposit_instructions_viewed_7d: number;
  payment_clicks_7d: number;
  payment_completion_pct: number | null;
  payment_approved_7d: number;
  payment_approved_keyboard_7d: number;
  keyboard_adoption_pct: number | null;
};

export async function isOpsEventsTableReady(): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const { error } = await db().from("ops_events").select("id").limit(1);
  if (!error) return true;
  const code = (error as { code?: string }).code;
  if (code === "PGRST205" || /ops_events/i.test(error.message)) return false;
  if (/invalid api key/i.test(error.message)) return false;
  throw error;
}

async function countActionSince(action: string, sinceIso: string): Promise<number> {
  const { count, error } = await db()
    .from("ops_events")
    .select("id", { count: "exact", head: true })
    .eq("action", action)
    .gte("ts", sinceIso);
  if (error) throw error;
  return count ?? 0;
}

async function countKeyboardApprovalsSince(sinceIso: string): Promise<number> {
  const { data, error } = await db()
    .from("ops_events")
    .select("detail")
    .eq("action", "admin.payment_approved")
    .gte("ts", sinceIso);
  if (error) throw error;
  return (data ?? []).filter(
    (r) => (r.detail as { interaction?: string } | null)?.interaction === "keyboard"
  ).length;
}

export async function fetchFunnelMetrics(now = new Date()): Promise<FunnelMetrics> {
  const empty: FunnelMetrics = {
    ops_events_ready: false,
    booking_flow_entered_7d: 0,
    booking_created_7d: 0,
    booking_conversion_pct: null,
    deposit_instructions_viewed_7d: 0,
    payment_clicks_7d: 0,
    payment_completion_pct: null,
    payment_approved_7d: 0,
    payment_approved_keyboard_7d: 0,
    keyboard_adoption_pct: null,
  };

  const ready = await isOpsEventsTableReady();
  if (!ready) return empty;

  const sinceIso = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();

  const [
    entered,
    created,
    depositViewed,
    linePay,
    lineOfficial,
    approved,
    keyboardApproved,
  ] = await Promise.all([
    countActionSince("guest.booking_flow_entered", sinceIso),
    countActionSince("guest.booking_created", sinceIso),
    countActionSince("guest.deposit_instructions_viewed", sinceIso),
    countActionSince("guest.payment_line_pay_click", sinceIso),
    countActionSince("guest.payment_line_official_click", sinceIso),
    countActionSince("admin.payment_approved", sinceIso),
    countKeyboardApprovalsSince(sinceIso),
  ]);

  const paymentClicks = linePay + lineOfficial;

  return {
    ops_events_ready: true,
    booking_flow_entered_7d: entered,
    booking_created_7d: created,
    booking_conversion_pct: calcConversionRate(created, entered),
    deposit_instructions_viewed_7d: depositViewed,
    payment_clicks_7d: paymentClicks,
    payment_completion_pct: calcConversionRate(paymentClicks, depositViewed),
    payment_approved_7d: approved,
    payment_approved_keyboard_7d: keyboardApproved,
    keyboard_adoption_pct: calcConversionRate(keyboardApproved, approved),
  };
}
