import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLookupToken } from "@/lib/lookup-token";
import {
  GUEST_REPLY_BANK_TRANSFER_REPORTED,
  validateTransferReport,
} from "@/lib/payment-events";
import { isAdminConfigured } from "@/lib/supabase-admin";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Customer bank-transfer report: evidence only, never a paid transition. */
export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "付款回報暫時無法使用" }, { status: 503 });
  }

  let body: { token?: unknown; accountLastFive?: unknown; amount?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "無效的請求" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const verified = verifyLookupToken(token);
  if (!verified.ok) {
    return NextResponse.json({ error: "訂位查詢連結無效，請重新查詢" }, { status: 400 });
  }

  const report = validateTransferReport({
    accountLastFive: body.accountLastFive,
    amount: body.amount,
  });
  if (!report.ok) {
    return NextResponse.json({ error: report.error, field: report.field }, { status: 400 });
  }

  const { data, error } = await db().rpc("record_bank_transfer_report", {
    p_reservation_id: verified.reservationId,
    p_reported_account_last_five: report.accountLastFive,
    p_reported_amount: report.amount,
  });
  if (error) {
    console.error("[payment/report] report RPC failed:", error.message);
    return NextResponse.json({ error: "付款回報暫時無法送出，請稍後再試" }, { status: 503 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    return NextResponse.json({ error: "找不到此訂位" }, { status: 404 });
  }

  if (result.outcome === "already_paid") {
    return NextResponse.json({ error: "此訂位的訂金已確認，請勿重複回報" }, { status: 409 });
  }
  if (result.outcome === "not_reportable") {
    return NextResponse.json({ error: "此訂位已取消或過期，無法回報匯款" }, { status: 409 });
  }
  if (result.outcome === "invalid_report") {
    return NextResponse.json({ error: "匯款回報資料格式不正確" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    duplicate: result.outcome === "duplicate",
    payment_event_id: result.payment_event_id,
    status: "pending_review",
    message: GUEST_REPLY_BANK_TRANSFER_REPORTED,
  });
}
