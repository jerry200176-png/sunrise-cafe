/**
 * Send deposit payment Flex to guest at most once (unless force).
 * Shared by: confirm/price PATCH, manual send-line, LINE bind.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendLineFlexMessage, buildPaymentFlex } from "@/lib/line";
import type { BranchPaymentConfig } from "@/lib/payment-message";
import { isWeekendDate } from "@/lib/booking-utils";

function defaultClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type SendPaymentRequestResult =
  | "sent"
  | "skipped_already_sent"
  | "skipped_paid"
  | "no_line_id"
  | "no_price"
  | "not_found"
  | "error";

type RoomRow = {
  name?: string;
  price_weekday?: number | null;
  price_weekend?: number | null;
  branch?: { id: string; name: string } | { id: string; name: string }[] | null;
};

function firstBranch(room: RoomRow | null): { id: string; name: string } | null {
  if (!room?.branch) return null;
  return Array.isArray(room.branch) ? room.branch[0] ?? null : room.branch;
}

/**
 * Push 「訂金繳費通知」to the guest Bot.
 * @param force — true for explicit staff resend; false skips if already sent
 */
export async function sendDepositPaymentRequest(
  reservationId: string,
  opts: { force?: boolean; client?: SupabaseClient } = {}
): Promise<{ result: SendPaymentRequestResult; detail?: string }> {
  const force = opts.force === true;
  const db = opts.client ?? defaultClient();

  const selectWithStamp = `
      id,
      line_user_id,
      customer_name,
      booking_code,
      start_time,
      end_time,
      created_at,
      total_price,
      status,
      is_deposit_paid,
      payment_request_sent_at,
      room:rooms(name, price_weekday, price_weekend, branch:branches(id, name))
    `;
  const selectWithoutStamp = `
      id,
      line_user_id,
      customer_name,
      booking_code,
      start_time,
      end_time,
      created_at,
      total_price,
      status,
      is_deposit_paid,
      room:rooms(name, price_weekday, price_weekend, branch:branches(id, name))
    `;

  let r: Record<string, unknown> | null = null;
  let stampColumnReady = true;

  {
    const first = await db
      .from("reservations")
      .select(selectWithStamp)
      .eq("id", reservationId)
      .maybeSingle();

    if (first.error && /payment_request_sent_at/i.test(first.error.message)) {
      stampColumnReady = false;
      const fallback = await db
        .from("reservations")
        .select(selectWithoutStamp)
        .eq("id", reservationId)
        .maybeSingle();
      if (fallback.error || !fallback.data) {
        return { result: "not_found", detail: fallback.error?.message };
      }
      r = fallback.data as Record<string, unknown>;
    } else if (first.error || !first.data) {
      return { result: "not_found", detail: first.error?.message };
    } else {
      r = first.data as Record<string, unknown>;
    }
  }

  if (r.is_deposit_paid) {
    return { result: "skipped_paid" };
  }

  if (!force && stampColumnReady && r.payment_request_sent_at) {
    return { result: "skipped_already_sent" };
  }

  if (!r.line_user_id) {
    return { result: "no_line_id" };
  }

  const roomRaw = r.room as RoomRow | RoomRow[] | null;
  const room = Array.isArray(roomRaw) ? roomRaw[0] ?? null : roomRaw;
  const branchRef = firstBranch(room);

  let total = r.total_price != null ? Number(r.total_price) : null;
  if (total == null && room) {
    const dateStr = String(r.start_time).slice(0, 10);
    const pricePerHour = isWeekendDate(dateStr)
      ? Number(room.price_weekend ?? 0)
      : Number(room.price_weekday ?? 0);
    const hours =
      (new Date(String(r.end_time)).getTime() - new Date(String(r.start_time)).getTime()) /
      3_600_000;
    total = Math.round(pricePerHour * hours);
    if (total > 0) {
      await db.from("reservations").update({ total_price: total }).eq("id", reservationId);
    }
  }

  if (total == null || total === 0) {
    return { result: "no_price" };
  }

  let branch: BranchPaymentConfig = { name: branchRef?.name ?? null };
  if (branchRef?.id) {
    const { data: b } = await db.from("branches").select("*").eq("id", branchRef.id).single();
    if (b) branch = b as BranchPaymentConfig;
  }

  const flex = buildPaymentFlex({
    customerName: String(r.customer_name),
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    total,
    branch,
    bookingCode: (r.booking_code as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  });

  try {
    await sendLineFlexMessage(String(r.line_user_id), "訂金繳費通知", flex);
    if (stampColumnReady) {
      const sentAt = new Date().toISOString();
      const { error: stampErr } = await db
        .from("reservations")
        .update({ payment_request_sent_at: sentAt })
        .eq("id", reservationId);
      if (stampErr) {
        console.warn(
          "[payment-request] stamped payment_request_sent_at failed:",
          stampErr.message
        );
      }
    } else {
      console.warn(
        "[payment-request] payment_request_sent_at column missing — run migration-reservations-payment-request-sent.sql"
      );
    }
    return { result: "sent" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[payment-request] LINE push failed:", detail);
    return { result: "error", detail };
  }
}
