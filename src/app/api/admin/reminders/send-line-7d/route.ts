import { NextRequest, NextResponse } from "next/server";
import { fetchReservationsIn7Days, updateReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";
import { sendLineMessage as sendLineMessageToUser } from "@/lib/line";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";

function toTaipei(s: string) {
  return new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

async function handleSend() {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  const rows = await fetchReservationsIn7Days();
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "無需提醒的訂位" });
  }

  let sent = 0;
  for (const r of rows) {
    const lineUserId = r.line_user_id as string;
    try {
      const startDate = toTaipei(r.start_time as string);
      const endDate = toTaipei(r.end_time as string);
      const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
      const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
      const room = r.room as { name?: string; branch?: { name?: string } } | undefined;
      const branchName = room?.branch?.name ?? "昇昇咖啡";

      const text =
        `您好，這裡是${branchName}！\n\n` +
        `提醒您 7 天後有包廂訂位：\n` +
        `📅 ${formattedDate} ${timeRange}\n` +
        `🏠 ${room?.name ?? ""}\n\n` +
        `如需調整請提早告知，期待您的光臨！`;

      await sendLineMessageToUser(lineUserId, text);
      await updateReservationAdmin(r.id as string, { is_reminded_7d: true });
      sent++;
    } catch (err) {
      console.error(`[send-line-7d] 傳送失敗 id=${r.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, sent });
}

/** GET: Vercel Cron 觸發 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  return handleSend();
}

/** POST: 手動觸發 */
export async function POST() {
  return handleSend();
}
