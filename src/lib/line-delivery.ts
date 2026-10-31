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

export type ExistingReminderDeliveryState = "sending" | "sent" | "failed" | "missing";
export type ReminderDeliveryKey = {
  reminderType: LineReminderDeliveryType;
  reminderDate: string;
  reservationId: string;
  recipientType: "group" | "guest";
  recipientId: string;
};

function isLedgerUnavailable(error: { message?: string; code?: string } | null): boolean {
  return Boolean(
    error &&
      (error.code === "PGRST202" ||
        error.code === "PGRST205" ||
        /line_reminder_deliveries|claim_line_reminder_delivery/i.test(error.message ?? ""))
  );
}

/** Atomically claim one reservation/recipient reminder before calling LINE. */
export async function claimLineReminderDelivery(input: ReminderDeliveryKey): Promise<LineDeliveryClaim> {
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

/** Resolve a lost claim without changing any ledger row or exposing recipient data. */
export async function readLineReminderDeliveryState(input: ReminderDeliveryKey): Promise<ExistingReminderDeliveryState> {
  const { data, error } = await supabaseAdmin()
    .from("line_reminder_deliveries")
    .select("status")
    .eq("reminder_type", input.reminderType)
    .eq("reminder_date", input.reminderDate)
    .eq("reservation_id", input.reservationId)
    .eq("recipient_type", input.recipientType)
    .eq("recipient_id", input.recipientId)
    .maybeSingle();
  // Do not expose raw database errors or assume a failed read means sent.
  if (error) throw new Error("無法確認提醒紀錄狀態");
  const status = (data as { status?: unknown } | null)?.status;
  return status === "sending" || status === "sent" || status === "failed" ? status : "missing";
}

/** A missing claim can mean the reservation changed after the candidate query. */
export async function isReminderNoLongerRequired(input: ReminderDeliveryKey): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .select("status,is_notified,d1_guest_reminder_sent_at,line_user_id")
    .eq("id", input.reservationId)
    .maybeSingle();
  if (error) throw new Error("無法確認訂位提醒狀態");
  if (!data) return false;
  const row = data as { status?: unknown; is_notified?: unknown; d1_guest_reminder_sent_at?: unknown; line_user_id?: unknown };
  if (typeof row.status !== "string") return false;
  if (["cancelled", "no_show", "completed"].includes(row.status)) return true;
  if (row.status !== "pending" && row.status !== "confirmed") return false;
  if (input.reminderType === "d1_group") return row.is_notified === true;
  if (input.reminderType === "d1_guest") {
    return Boolean(row.d1_guest_reminder_sent_at) || row.line_user_id === null;
  }
  return false;
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

export function safeLineDeliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/U[0-9a-f]{32}/gi, "[redacted_line_user]").slice(0, 500);
}
