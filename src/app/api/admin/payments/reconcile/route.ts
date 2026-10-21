import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { computeDepositDeadline, isDepositAutoCancelEnabled, shouldAutoRelease } from "@/lib/deposit-deadline";
import { parseBankCsv, matchBankRowsToReservations } from "@/lib/payment-reconcile";
import { getDepositAmount } from "@/lib/booking-utils";
import { logPayment } from "@/lib/payment-log";
import { requirePermission } from "@/lib/admin-api-auth";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** GET: 訂金逾期風險清單（#55 營運檢視，不自動取消） */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "payments:read");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }
  try {
    const { data: rows, error } = await db()
      .from("reservations")
      .select("id, booking_code, customer_name, phone, start_time, created_at, status")
      .in("status", ["pending", "confirmed"])
      .eq("is_deposit_paid", false)
      .order("start_time", { ascending: true });
    if (error) throw error;
    const now = new Date();
    const autoCancel = isDepositAutoCancelEnabled();
    const items = (rows ?? []).map((r) => {
      const deadline = computeDepositDeadline(r.created_at, r.start_time);
      return {
        id: r.id,
        booking_code: r.booking_code,
        customer_name: r.customer_name,
        phone: r.phone,
        status: r.status,
        start_time: r.start_time,
        created_at: r.created_at,
        deadline: deadline.toISOString(),
        deadline_passed: shouldAutoRelease(deadline, now),
        // ADR-012：開關關閉時逾期不會自動取消
        would_auto_release: autoCancel && shouldAutoRelease(deadline, now),
      };
    });
    return NextResponse.json({ count: items.length, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST: 上傳銀行 CSV 對帳（MVP） */
export async function POST(request: NextRequest) {
  const denied = await requirePermission(request, "payments:approve");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "請上傳 CSV 檔案" }, { status: 400 });
    }
    const text = await file.text();
    const bankRows = parseBankCsv(text);

    const { data: rows, error } = await db()
      .from("reservations")
      .select("id, booking_code, customer_name, total_price, deposit_payment_note, status, is_deposit_paid")
      .in("status", ["pending", "confirmed"])
      .eq("is_deposit_paid", false);
    if (error) throw error;

    const reservations = (rows ?? [])
      .filter((r) => r.total_price != null)
      .map((r) => ({
        id: r.id,
        booking_code: r.booking_code,
        customer_name: r.customer_name,
        deposit_amount: getDepositAmount(Number(r.total_price)),
        deposit_payment_note: r.deposit_payment_note,
      }));

    const { matches, unmatched } = matchBankRowsToReservations(bankRows, reservations);
    logPayment("payment_reconcile.import", {
      bank_rows: bankRows.length,
      matches: matches.length,
      unmatched: unmatched.length,
    });

    return NextResponse.json({
      bank_rows: bankRows.length,
      matches,
      unmatched,
      note: "MVP 僅建議配對，不自動標記已付；請於付款審核或訂位列表手動確認",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "對帳失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
