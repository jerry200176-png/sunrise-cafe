import { NextResponse } from "next/server";
import {
  fetchPendingPaymentEvents,
  isPaymentEventsTableReady,
} from "@/lib/payment-events-admin";
import { isAdminConfigured } from "@/lib/supabase-admin";

/** GET: 待審核付款事件列表 */
export async function GET() {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }
  try {
    const ready = await isPaymentEventsTableReady();
    if (!ready) {
      return NextResponse.json(
        {
          error: "payment_events 表尚未建立，請先執行 supabase/migration-payment-events.sql",
          migration_required: true,
        },
        { status: 503 }
      );
    }
    const items = await fetchPendingPaymentEvents();
    return NextResponse.json(items);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
