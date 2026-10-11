import { supabaseAdmin } from "@/lib/supabase-admin";
import { deliverOnce } from "@/lib/deliver-once";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LineGuestDeliveryClaim =
  | { available: true; id: string }
  | { available: true; id: null }
  | { available: false; id: null };

export type LineGuestNotificationType =
  | "deposit_request"
  | "booking_cancelled"
  | "booking_rescheduled"
  | "attendance_confirmed";

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
  notificationType: LineGuestNotificationType;
  reservationId: string;
  recipientId: string;
  eventKey?: string;
  client?: SupabaseClient;
}): Promise<LineGuestDeliveryClaim> {
  const { data, error } = await (input.client ?? supabaseAdmin())
    .rpc("claim_line_guest_notification_delivery", {
      p_notification_type: input.notificationType,
      p_reservation_id: input.reservationId,
      p_recipient_id: input.recipientId,
      p_event_key: input.eventKey ?? "default",
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

/** Deliver one automatic guest lifecycle notification at most once (see deliver-once.ts). */
export function deliverLineGuestNotification(input: {
  notificationType: Exclude<LineGuestNotificationType, "deposit_request">;
  reservationId: string;
  recipientId: string;
  eventKey?: string;
  send: () => Promise<void>;
  client?: SupabaseClient;
}): Promise<"sent" | "skipped" | "error"> {
  return deliverOnce(input.notificationType, input.reservationId, input.recipientId, input.send, {
    eventKey: input.eventKey,
    client: input.client,
  });
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
