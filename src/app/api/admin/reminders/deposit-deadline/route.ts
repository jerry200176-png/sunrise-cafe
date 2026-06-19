import { NextRequest, NextResponse } from "next/server";
import {
  fetchUnpaidPendingReservations,
  updateReservationAdmin,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { sendLineMessage as sendLineMessageToUser } from "@/lib/line";
import { sendLineMessage as sendLineMessageToGroup } from "@/lib/line-notify";
import { computeDepositDeadline, shouldAutoRelease, shouldSendDepositReminder } from "@/lib/deposit-deadline";
import { notifyWaitlist } from "@/lib/waitlist";
import { toTaipei } from "@/lib/datetime";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";

type Row = {
  id: string;
  booking_code: string;
  customer_name: string;
  phone: string;
  start_time: string;
  end_time: string;
  created_at: string;
  line_user_id: string | null;
  deposit_reminder_sent_at: string | null;
  room: { id: string; name: string; branch?: { name?: string } } | null;
};

function describe(r: Row) {
  const startDate = toTaipei(r.start_time);
  const endDate = toTaipei(r.end_time);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  const branchName = r.room?.branch?.name ?? "昇昇咖啡";
  return { formattedDate, timeRange, branchName };
}

async function handleRun() {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  const rows = (await fetchUnpaidPendingReservations()) as unknown as Row[];
  const now = new Date();
  let released = 0;
  let reminded = 0;

  for (const r of rows) {
    const deadline = computeDepositDeadline(r.created_at, r.start_time);
    const { formattedDate, timeRange, branchName } = describe(r);

    if (shouldAutoRelease(deadline, now)) {
      try {
        await updateReservationAdmin(r.id, { status: "cancelled" });

        if (r.line_user_id) {
          await sendLineMessageToUser(
            r.line_user_id,
            `您好，這裡是${branchName}。\n\n` +
              `很抱歉，您 ${formattedDate} ${timeRange} 的包廂預約（訂位代號 ${r.booking_code}）因逾期未收到訂金，座位已自動釋放。\n` +
              `如仍需訂位，歡迎重新預約，謝謝！`
          ).catch((err) => console.error("[deposit-deadline] 客人通知失敗:", err));
        }

        await sendLineMessageToGroup(
          `⏰ 訂金逾期未付款，已自動取消並釋放\n` +
            `姓名：${r.customer_name}\n` +
            `電話：${r.phone}\n` +
            `代號：${r.booking_code}\n` +
            `時間：${formattedDate} ${timeRange}`
        ).catch((err) => console.error("[deposit-deadline] 群組通知失敗:", err));

        notifyWaitlist(r.room?.id ?? "", r.start_time, r.end_time).catch((err) =>
          console.error("[deposit-deadline] waitlist notify failed:", err)
        );

        released++;
      } catch (err) {
        console.error(`[deposit-deadline] 釋放失敗 id=${r.id}:`, err);
      }
      continue;
    }

    if (r.line_user_id && shouldSendDepositReminder(deadline, r.deposit_reminder_sent_at, now)) {
      try {
        await sendLineMessageToUser(
          r.line_user_id,
          `您好，這裡是${branchName}。\n\n` +
            `提醒您 ${formattedDate} ${timeRange} 的包廂預約（訂位代號 ${r.booking_code}）訂金尚未收到。\n` +
            `請盡快完成匯款或 LINE Pay 付款（資訊請參考先前訊息），逾期座位將自動釋放，敬請留意，謝謝！`
        );
        await updateReservationAdmin(r.id, { deposit_reminder_sent_at: now.toISOString() });
        reminded++;
      } catch (err) {
        console.error(`[deposit-deadline] 提醒失敗 id=${r.id}:`, err);
      }
    }
  }

  return NextResponse.json({ ok: true, released, reminded });
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
  return handleRun();
}

/** POST: 手動觸發 */
export async function POST() {
  return handleRun();
}
