import { NextRequest, NextResponse } from "next/server";
import { retryDueLinePayNotifications } from "@/lib/linepay-notification-outbox";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeCronGet } from "@/lib/cron-request-auth";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

/** Internal retry worker. It never accepts customer or payment values from the caller. */
async function run(request: NextRequest, allowVercelCron = false) {
  if (allowVercelCron) {
    const auth = authorizeCronGet(request);
    if (!auth.ok) return auth.response;
  } else if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await retryDueLinePayNotifications(supabaseAdmin());
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "Notification retry failed" }, { status: 503 });
  }
}

export async function GET(request: NextRequest) { return run(request, true); }
export async function POST(request: NextRequest) { return run(request, false); }
