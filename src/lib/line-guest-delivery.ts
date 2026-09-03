import { supabaseAdmin } from "@/lib/supabase-admin";
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

/** Deliver one automatic guest notification after its durable claim succeeds. */
export async function deliverLineGuestNotification(input: {
  notificationType: Exclude<LineGuestNotificationType, "deposit_request">;
  reservationId: string;
  recipientId: string;
  eventKey?: string;
  send: () => Promise<void>;
  client?: SupabaseClient;
}): Promise<"sent" | "skipped" | "error"> {
  const claim = await claimLineGuestNotificationDelivery({
    notificationType: input.notificationType,
    reservationId: input.reservationId,
    recipientId: input.recipientId,
    eventKey: input.eventKey,
    client: input.client,
  });
  if (claim.available && !claim.id) return "skipped";

  try {
    await input.send();
    if (claim.id) {
      try {
        await markLineGuestNotificationDelivery(claim.id, { status: "sent" }, input.client);
      } catch (error) {
        console.warn(
          "[line-guest-delivery] success state update failed:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    return "sent";
  } catch (error) {
    if (claim.id) {
      try {
        await markLineGuestNotificationDelivery(
          claim.id,
          { status: "failed", error: error instanceof Error ? error.message : String(error) },
          input.client
        );
      } catch (markError) {
        console.warn(
          "[line-guest-delivery] failure state update failed:",
          markError instanceof Error ? markError.message : String(markError)
        );
      }
    }
    console.error(
      `[line-guest-delivery] ${input.notificationType} push failed:`,
      error instanceof Error ? error.message : String(error)
    );
    return "error";
  }
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
