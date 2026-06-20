import { createClient } from "@supabase/supabase-js";
import { sendLineFlexMessage, buildWaitlistFlex, WAITLIST_CONFIRM_WINDOW_MINUTES } from "@/lib/line";

export { WAITLIST_CONFIRM_WINDOW_MINUTES };

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 取消訂位後，通知等位清單中第一位符合條件的客人
export async function notifyWaitlist(
  roomId: string,
  cancelledStart: string,
  cancelledEnd: string
) {
  // 找出同包廂、時段重疊、尚在等位的第一筆
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
  if (!entry) return;

  // 找客人是否有綁定 LINE（從同電話的訂位查詢）
  const { data: reservations } = await supabaseAdmin()
    .from("reservations")
    .select("line_user_id")
    .eq("phone", entry.phone)
    .not("line_user_id", "is", null)
    .limit(1);

  const lineUserId = reservations?.[0]?.line_user_id as string | null;

  if (lineUserId) {
    try {
      const flex = buildWaitlistFlex({
        startTime: entry.start_time,
        endTime: entry.end_time,
        confirmToken: entry.confirm_token,
      });
      await sendLineFlexMessage(lineUserId, "您等位的時段空出來了！", flex);
    } catch (err) {
      console.error("[waitlist] LINE 通知失敗:", err);
    }
  }

  // 標記為已通知（無論 LINE 是否成功，避免重複通知）
  await supabaseAdmin()
    .from("waitlist")
    .update({ status: "notified", notified_at: new Date().toISOString() })
    .eq("id", entry.id);

  console.log(`[waitlist] 已通知等位客人 phone=${entry.phone}, lineUserId=${lineUserId ?? "無"}`);
}
