import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { paymentEventInScope } from "@/lib/payment-event-scope";
import { fetchLineMessageContent } from "@/lib/line-content";
import { parseLineImageMessageId } from "@/lib/payment-event-payload";
import { isAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { branchCustomerBots, customerTokenForBranch } from "@/lib/customer-line-bots";
import { branchIdForReservation } from "@/lib/branch-line-group";

type Params = { params: Promise<{ id: string }> };

/** GET: proxy LINE payment screenshot for staff review (no persistent storage) */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requirePermission(request, "payments:read");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const { id } = await params;
  try {
    if (!await paymentEventInScope(id, await getAdminContext(request))) {
      return NextResponse.json({ error: "找不到付款事件" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "付款資料暫時無法讀取" }, { status: 503 });
  }
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: event, error } = await db
    .from("payment_events")
    .select("source, raw_payload, status, reservation_id")
    .eq("id", id)
    .single();

  if (error || !event) {
    return NextResponse.json({ error: "找不到付款事件" }, { status: 404 });
  }
  if (event.source !== "line_image") {
    return NextResponse.json({ error: "非 LINE 截圖來源" }, { status: 400 });
  }

  const messageId = parseLineImageMessageId(event.raw_payload);
  if (!messageId) {
    return NextResponse.json(
      { error: "此筆為舊版紀錄，無 LINE message id，請至 LINE 核對" },
      { status: 404 }
    );
  }

  try {
    // A screenshot sent to a store's own account is only downloadable with that account's token.
    const branchId = branchCustomerBots().length && event.reservation_id
      ? await branchIdForReservation(supabaseAdmin(), String(event.reservation_id))
      : null;
    const { body, contentType } = await fetchLineMessageContent(messageId, customerTokenForBranch(branchId));
    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
