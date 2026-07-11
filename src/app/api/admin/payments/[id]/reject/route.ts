import { NextRequest, NextResponse } from "next/server";
import { rejectPaymentEvent } from "@/lib/payment-events-admin";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/admin-api-auth";
import { logOps, type AdminPaymentInteraction } from "@/lib/ops-log";

type Params = { params: Promise<{ id: string }> };

/** POST: 駁回付款截圖 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requirePermission(request, "payments:approve");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reviewNote = typeof body.review_note === "string" ? body.review_note : "";
  const interaction: AdminPaymentInteraction = body.interaction === "keyboard" ? "keyboard" : "click";

  try {
    const result = await rejectPaymentEvent(id, reviewNote);
    if (!result.already_processed) {
      logOps("admin", "admin.payment_rejected", { payment_event_id: id, interaction });
    }
    return NextResponse.json({ ok: true, already_processed: result.already_processed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "駁回失敗";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
