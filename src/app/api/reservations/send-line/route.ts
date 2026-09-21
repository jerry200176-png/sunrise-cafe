import { NextRequest, NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { requireAdminApiAuth, getAdminContext } from "@/lib/admin-api-auth";
import { assertReservationMessageSendAllowed } from "@/lib/reservation-access";
import { fetchReservationBranchId } from "@/lib/supabase-admin";
import { sendDepositPaymentRequest } from "@/lib/payment-request-line";

/** Explicit staff resend of deposit payment Flex (force=true). */
export async function POST(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  const { id } = (await request.json()) as { id: string };
  if (!id) return NextResponse.json({ error: "缺少訂位 id" }, { status: 400 });

  const branchId = await fetchReservationBranchId(id);
  if (!branchId) {
    return NextResponse.json({ error: "找不到訂位或分店" }, { status: 404 });
  }
  const ctx = await getAdminContext(request);
  const rbacDenied = assertReservationMessageSendAllowed(ctx, branchId);
  if (rbacDenied) {
    return NextResponse.json({ error: rbacDenied }, { status: 403 });
  }

  const { result, detail } = await sendDepositPaymentRequest(id, {
    force: true,
    actorUserId: ctx.user_id,
  });

  if (result === "sent") {
    return NextResponse.json({
      ok: true,
      result,
      delivery_status: "accepted_by_line_platform",
    });
  }
  if (result === "no_line_id") {
    return NextResponse.json(
      {
        error:
          "客人尚未綁定 LINE，請客人在訂位成功頁點「用 LINE 登入綁定通知」後再試",
      },
      { status: 422 }
    );
  }
  if (result === "no_price") {
    return NextResponse.json(
      { error: "此訂位尚未設定總金額，請先在後台編輯填入金額" },
      { status: 422 }
    );
  }
  if (result === "skipped_paid") {
    return NextResponse.json({ error: "此訂位訂金已付，無需再傳繳費通知" }, { status: 422 });
  }
  if (result === "not_found") {
    return NextResponse.json({ error: "找不到訂位資料" }, { status: 404 });
  }

  return NextResponse.json(
    { error: detail ?? "LINE 發送失敗" },
    { status: 500 }
  );
}
