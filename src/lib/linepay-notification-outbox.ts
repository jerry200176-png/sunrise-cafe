import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPaymentConfirmedFlex, sendLineFlexToBranchGroup } from "@/lib/line-notify";
import { safeLinePayError } from "@/lib/linepay-lifecycle";
import { stableLineRetryKey } from "@/lib/line-retry-key";
import { branchLineGroupIdForReservation } from "@/lib/branch-line-group";

type OutboxRow = {
  id: string;
  status: "pending" | "retrying" | "sent" | "failed";
  attempt_count: number;
  payload: {
    customer_name?: string;
    booking_code?: string;
    start_time?: string;
    end_time?: string;
    amount?: number;
  };
};

function retryDelay(attempt: number): number {
  return Math.min(60 * 60 * 1000, 30 * 1000 * 2 ** Math.max(0, attempt - 1));
}

export async function deliverLinePayNotification(
  outboxId: string,
  db: SupabaseClient
): Promise<"sent" | "failed" | "skipped"> {
  const { data: current, error: readError } = await db
    .from("line_pay_notification_outbox")
    .select("id, status, attempt_count, payload")
    .eq("id", outboxId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current || current.status === "sent") return "skipped";

  const attempt = Number(current.attempt_count ?? 0) + 1;
  const { data: claimed, error: claimError } = await db
    .from("line_pay_notification_outbox")
    .update({
      status: "retrying",
      attempt_count: attempt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", outboxId)
    // Compare-and-swap on both status and attempt count. Only one worker can
    // claim a pending/retrying row for a given attempt.
    .eq("status", current.status)
    .eq("attempt_count", Number(current.attempt_count ?? 0))
    .select("id, status, attempt_count, payload, reservation_id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return "skipped";

  const payload = claimed.payload as OutboxRow["payload"];
  try {
    if (!payload.customer_name || !payload.booking_code || !payload.start_time || !payload.end_time) {
      throw new Error("LINE Pay notification payload is incomplete");
    }
    await sendLineFlexToBranchGroup(
      `LINE Pay payment confirmed: ${payload.customer_name}`,
      buildPaymentConfirmedFlex({
        customerName: payload.customer_name,
        bookingCode: payload.booking_code,
        startTime: payload.start_time,
        endTime: payload.end_time,
        rawText: `LINE Pay paid: NT$ ${Number(payload.amount ?? 0)}`,
      }),
      claimed.reservation_id ? await branchLineGroupIdForReservation(db, String(claimed.reservation_id)) : null,
      { retryKey: stableLineRetryKey("linepay-confirmed-group", outboxId) }
    );
    await db.from("line_pay_notification_outbox").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", outboxId).eq("status", "retrying");
    await db.from("line_pay_notification_attempts").insert({
      outbox_id: outboxId,
      attempt_number: attempt,
      status: "sent",
    });
    return "sent";
  } catch (error) {
    const lastError = safeLinePayError(error);
    const nextStatus = attempt >= 5 ? "failed" : "retrying";
    await db.from("line_pay_notification_outbox").update({
      status: nextStatus,
      last_error: lastError,
      next_retry_at: new Date(Date.now() + retryDelay(attempt)).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", outboxId).eq("status", "retrying");
    await db.from("line_pay_notification_attempts").insert({
      outbox_id: outboxId,
      attempt_number: attempt,
      status: "failed",
      error_message: lastError,
    });
    console.error("[linepay] notification delivery failed", {
      outbox_id: outboxId,
      attempt,
      error: lastError,
    });
    return "failed";
  }
}

export async function retryDueLinePayNotifications(
  db: SupabaseClient,
  limit = 20
): Promise<{ sent: number; failed: number; skipped: number }> {
  const { data, error } = await db
    .from("line_pay_notification_outbox")
    .select("id")
    .in("status", ["pending", "retrying"])
    .lte("next_retry_at", new Date().toISOString())
    .order("next_retry_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const row of data ?? []) {
    result[await deliverLinePayNotification(String(row.id), db)] += 1;
  }
  return result;
}
