import { createClient } from "@supabase/supabase-js";
import { sendLineMessage as sendLineMessageToUser } from "@/lib/line";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function toTaipei(s: string) {
  return new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
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
    .select("id, customer_name, phone, start_time, end_time")
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

  const startDate = toTaipei(entry.start_time);
  const endDate = toTaipei(entry.end_time);
  const dateStr = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;

  if (lineUserId) {
    try {
      await sendLineMessageToUser(
        lineUserId,
        `您好，這裡是昇昇咖啡！\n\n` +
        `您等位的時段有空位了！\n` +
        `📅 ${dateStr} ${timeRange}\n\n` +
        `請盡快至官網完成訂位，時段不保留，先搶先贏！\n` +
        `https://sunrise-cafe-six.vercel.app/book`
      );
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
