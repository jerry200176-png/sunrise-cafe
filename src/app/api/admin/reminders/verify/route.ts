import { NextRequest, NextResponse } from "next/server";
import { verifyReminderCron } from "@/lib/reminder-cron-verify";
import { errorToDetail } from "@/lib/cron-alert";

/** GET: read-only send-line cron diagnostics (admin session or CRON_SECRET) */
export async function GET(_request: NextRequest) {
  try {
    const report = await verifyReminderCron();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: errorToDetail(err) }, { status: 500 });
  }
}
