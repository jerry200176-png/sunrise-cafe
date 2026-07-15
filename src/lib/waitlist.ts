/**
 * Waitlist fan-out after a slot frees (cancel / deposit release / waitlist expiry).
 * Only mark `notified` after a successful guest LINE push — otherwise leave `waiting`
 * so ops can call, or a later release can retry. (Market: inline-style waitlist.)
 */
import { createClient } from "@supabase/supabase-js";
import { sendLineFlexMessage } from "@/lib/line";
import { buildWaitlistFlex, WAITLIST_CONFIRM_WINDOW_MINUTES } from "@/lib/line-cards";

export { WAITLIST_CONFIRM_WINDOW_MINUTES };

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type NotifyWaitlistResult =
  | { outcome: "none" }
  | { outcome: "no_line"; entryId: string; phone: string }
  | { outcome: "line_failed"; entryId: string; phone: string; error: string }
  | { outcome: "notified"; entryId: string; phone: string };

export async function notifyWaitlist(
  roomId: string,
  cancelledStart: string,
  cancelledEnd: string
): Promise<NotifyWaitlistResult> {
  const { data: entries } = await supabaseAdmin()
    .from("waitlist")
    .select("id, customer_name, phone, start_time, end_time, confirm_token")
    .eq("room_id", roomId)
    .eq("status", "waiting")
    .lt("start_time", cancelledEnd)
    .gt("end_time", cancelledStart)
    .order("created_at", { ascending: true })
    .limit(1);

  const entry = entries?.[0];
  if (!entry) return { outcome: "none" };

  const { data: reservations } = await supabaseAdmin()
    .from("reservations")
    .select("line_user_id")
    .eq("phone", entry.phone)
    .not("line_user_id", "is", null)
    .limit(1);

  const lineUserId = reservations?.[0]?.line_user_id as string | null;

  if (!lineUserId) {
    console.warn(
      `[waitlist] skip mark notified — no LINE bind for phone=${entry.phone}; leave waiting for staff call / retry`
    );
    return { outcome: "no_line", entryId: entry.id, phone: entry.phone };
  }

  try {
    const flex = buildWaitlistFlex({
      startTime: entry.start_time,
      endTime: entry.end_time,
      confirmToken: entry.confirm_token,
    });
    await sendLineFlexMessage(lineUserId, "您等位的時段空出來了！", flex);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[waitlist] LINE 通知失敗，保持 waiting:", detail);
    return { outcome: "line_failed", entryId: entry.id, phone: entry.phone, error: detail };
  }

  await supabaseAdmin()
    .from("waitlist")
    .update({ status: "notified", notified_at: new Date().toISOString() })
    .eq("id", entry.id);

  console.log(`[waitlist] notified phone=${entry.phone}`);
  return { outcome: "notified", entryId: entry.id, phone: entry.phone };
}
