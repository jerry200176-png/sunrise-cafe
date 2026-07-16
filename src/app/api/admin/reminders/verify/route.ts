import { NextRequest, NextResponse } from "next/server";
import { verifyReminderCron } from "@/lib/reminder-cron-verify";
import { errorToDetail } from "@/lib/cron-alert";

/** GET: read-only send-line cron diagnostics (admin session or CRON_SECRET) */
export async function GET(request: NextRequest) {
  try {
    // Touch request so lint keeps the signature (auth is enforced in middleware)
    void request.headers.get("authorization");
    const report = await verifyReminderCron();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: errorToDetail(err) }, { status: 500 });
  }
}
