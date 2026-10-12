import { supabaseAdmin } from "@/lib/supabase-admin";

export type LineReminderDeliveryType =
  | "d1_group"
  | "d1_guest"
  | "d7_guest"
  | "deposit_initial"
  | "deposit_urgent"
  | "deposit_release_guest"
  | "deposit_release_group"
  | "deposit_restore_hold";

export type LineDeliveryClaim =
  | { available: true; id: string }
  | { available: true; id: null }
  | { available: false; id: null };

function isLedgerUnavailable(error: { message?: string; code?: string } | null): boolean {
  return Boolean(
    error &&
      (error.code === "PGRST202" ||
        error.code === "PGRST205" ||
        /line_reminder_deliveries|claim_line_reminder_delivery/i.test(error.message ?? ""))
  );
}

/** Atomically claim one reservation/recipient reminder before calling LINE. */
export async function claimLineReminderDelivery(input: {
  reminderType: LineReminderDeliveryType;
  reminderDate: string;
  reservationId: string;
  recipientType: "group" | "guest";
  recipientId: string;
}): Promise<LineDeliveryClaim> {
  const { data, error } = await supabaseAdmin()
    .rpc("claim_line_reminder_delivery", {
      p_reminder_type: input.reminderType,
      p_reminder_date: input.reminderDate,
      p_reservation_id: input.reservationId,
      p_recipient_type: input.recipientType,
      p_recipient_id: input.recipientId,
    })
    .maybeSingle();

  if (error) {
    if (isLedgerUnavailable(error)) {
      if (process.env.VERCEL_ENV === "production") {
        const detail = [error.code, error.message].filter(Boolean).join(": ").slice(0, 240);
        throw new Error(
          `LINE reminder delivery ledger unavailable in production${detail ? ` (${detail})` : ""}`
        );
      }
      return { available: false, id: null };
    }
    throw error;
  }
  return { available: true, id: (data as { delivery_id?: string } | null)?.delivery_id ?? null };
}

export async function markLineReminderDelivery(
  id: string,
  result: { status: "sent" | "failed"; error?: string | null }
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("line_reminder_deliveries")
    .update({
      status: result.status,
      sent_at: result.status === "sent" ? new Date().toISOString() : null,
      last_error: result.error ?? null,
    })
    .eq("id", id);
  if (error) {
    if (isLedgerUnavailable(error) && process.env.VERCEL_ENV !== "production") return;
    throw error;
  }
}

/** Atomically reclaim one failed delivery for a later retry. */
export async function claimFailedLineReminderDelivery(id: string): Promise<boolean> {
  const client = supabaseAdmin();
  const { data: current, error: readError } = await client
    .from("line_reminder_deliveries")
    .select("id, attempt_count")
    .eq("id", id)
    .eq("status", "failed")
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return false;

  const { data, error } = await client
    .from("line_reminder_deliveries")
    .update({
      status: "sending",
      attempt_count: Number(current.attempt_count ?? 0) + 1,
      last_error: null,
      sent_at: null,
      created_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "failed")
    .eq("attempt_count", Number(current.attempt_count ?? 0))
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** A reschedule creates a new reminder version, even when its calendar day is unchanged. */
export async function resetLineReminderDeliveries(reservationId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("line_reminder_deliveries")
    .delete()
    .eq("reservation_id", reservationId);
  if (error) {
    if (isLedgerUnavailable(error) && process.env.VERCEL_ENV !== "production") return;
    throw error;
  }
}

/**
 * Staff restored an unpaid booking after its deposit deadline (#437). The ledger
 * row is the marker (no schema change): the deposit-deadline cron must not
 * re-release it until staff decide (mark paid / cancel / no-show).
 */
export async function holdDepositRelease(reservationId: string, startTime: string): Promise<void> {
  const claim = await claimLineReminderDelivery({
    reminderType: "deposit_restore_hold",
    reminderDate: new Date(new Date(startTime).getTime() + 8 * 3_600_000).toISOString().slice(0, 10),
    reservationId,
    recipientType: "group",
    recipientId: "restore-hold",
  });
  if (claim.id) await markLineReminderDelivery(claim.id, { status: "sent" });
}

/** True when this reservation was already released once or restored-and-held. */
export async function hasDepositReleaseHold(reservationId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("line_reminder_deliveries")
    .select("id")
    .eq("reservation_id", reservationId)
    .in("reminder_type", ["deposit_restore_hold", "deposit_release_guest", "deposit_release_group"])
    .limit(1);
  if (error) {
    if (isLedgerUnavailable(error) && process.env.VERCEL_ENV !== "production") return false;
    throw error;
  }
  return (data?.length ?? 0) > 0;
}

export function safeLineDeliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/U[0-9a-f]{32}/gi, "[redacted_line_user]").slice(0, 500);
}
