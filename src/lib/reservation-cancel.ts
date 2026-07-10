/**
 * Unified reservation cancellation with metadata for analytics + DQ.
 */
import { updateReservationAdmin } from "@/lib/supabase-admin";

export type CancelledBy = "guest" | "admin" | "system_deposit" | "system_other";

export const CANCELLATION_REASON_CODES = [
  "schedule_conflict",
  "found_alternative",
  "price_concern",
  "deposit_timeout",
  "admin_request",
  "other",
] as const;

export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number];

export async function cancelReservation(params: {
  id: string;
  cancelled_by: CancelledBy;
  cancellation_reason?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await updateReservationAdmin(params.id, {
    status: "cancelled",
    cancelled_at: now,
    cancelled_by: params.cancelled_by,
    cancellation_reason: params.cancellation_reason?.trim() || null,
  } as Parameters<typeof updateReservationAdmin>[1]);
}
