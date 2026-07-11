import { NextRequest, NextResponse } from "next/server";
import { fetchReservationsIn7Days, updateReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";
import { sendLineFlexMessage, buildReminderFlex } from "@/lib/line";
import { runCronJob } from "@/lib/job-runs";
import { errorToDetail } from "@/lib/cron-alert";

async function handleSend() {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  try {
    const rows = await fetchReservationsIn7Days();
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "無需提醒的訂位" });
  }

  let sent = 0;
  let errors = 0;
  for (const r of rows) {
    const lineUserId = r.line_user_id as string;
    try {
      const room = r.room as { name?: string; branch?: { name?: string } } | undefined;
      const flex = buildReminderFlex({
        leadLabel: "7 天後",
        branchName: room?.branch?.name ?? "昇昇咖啡",
        roomName: room?.name ?? null,
        startTime: r.start_time as string,
        endTime: r.end_time as string,
      });

      await sendLineFlexMessage(lineUserId, "7 天後訂位提醒", flex);
      await updateReservationAdmin(r.id as string, { is_reminded_7d: true });
      sent++;
    } catch (err) {
      errors++;
      console.error(`[send-line-7d] 傳送失敗 id=${r.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, sent, errors });
  } catch (err) {
    return NextResponse.json({ error: errorToDetail(err) }, { status: 500 });
  }
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
  return runCronJob("send-line-7d", () => handleSend());
}

/** POST: 手動觸發 */
export async function POST() {
  return runCronJob("send-line-7d", () => handleSend());
}
