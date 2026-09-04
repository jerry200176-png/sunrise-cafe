import { supabaseAdmin } from "@/lib/supabase-admin";

export type LineReminderDeliveryType =
  | "d1_group"
  | "d1_guest"
  | "d7_guest"
  | "deposit_initial"
  | "deposit_urgent"
  | "deposit_release_guest"
  | "deposit_release_group";

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

export function safeLineDeliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/U[0-9a-f]{32}/gi, "[redacted_line_user]").slice(0, 500);
}
