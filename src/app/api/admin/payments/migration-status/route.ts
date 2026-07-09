import { NextResponse } from "next/server";
import { isPaymentEventsTableReady } from "@/lib/payment-events-admin";
import { isAdminConfigured } from "@/lib/supabase-admin";

/** GET: 檢查 payment_events migration 是否已套用 */
export async function GET() {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }
  try {
    const ready = await isPaymentEventsTableReady();
    return NextResponse.json({
      payment_events_ready: ready,
      migration_file: "supabase/migration-payment-events.sql",
      instructions:
        ready
          ? "表已就緒"
          : "Supabase Dashboard → SQL Editor → 貼上 migration-payment-events.sql 全文執行",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "檢查失敗";
    return NextResponse.json({ error: message, payment_events_ready: false }, { status: 500 });
  }
}
