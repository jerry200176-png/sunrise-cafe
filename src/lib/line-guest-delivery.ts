import { supabaseAdmin } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LineGuestDeliveryClaim =
  | { available: true; id: string }
  | { available: true; id: null }
  | { available: false; id: null };

function isLedgerUnavailable(error: { message?: string; code?: string } | null): boolean {
  return Boolean(
    error &&
      (error.code === "PGRST202" ||
        error.code === "PGRST205" ||
        /line_guest_notification_deliveries|claim_line_guest_notification_delivery/i.test(
          error.message ?? ""
        ))
  );
}

/** Atomically claim an automatic guest notification before calling LINE. */
export async function claimLineGuestNotificationDelivery(input: {
  notificationType: "deposit_request";
  reservationId: string;
  recipientId: string;
  client?: SupabaseClient;
}): Promise<LineGuestDeliveryClaim> {
  const { data, error } = await (input.client ?? supabaseAdmin())
    .rpc("claim_line_guest_notification_delivery", {
      p_notification_type: input.notificationType,
      p_reservation_id: input.reservationId,
      p_recipient_id: input.recipientId,
    })
    .maybeSingle();

  if (error) {
    if (isLedgerUnavailable(error)) {
      if (process.env.VERCEL_ENV === "production") {
        throw new Error("LINE guest notification delivery ledger unavailable in production");
      }
      return { available: false, id: null };
    }
    throw error;
  }

  return {
    available: true,
    id: (data as { delivery_id?: string } | null)?.delivery_id ?? null,
  };
}

export async function markLineGuestNotificationDelivery(
  id: string,
  result: { status: "sent" | "failed"; error?: string | null },
  client?: SupabaseClient
): Promise<void> {
  const { error } = await (client ?? supabaseAdmin())
    .from("line_guest_notification_deliveries")
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
