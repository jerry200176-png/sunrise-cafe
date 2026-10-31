import { NextRequest, NextResponse } from "next/server";
import { approvePaymentEvent } from "@/lib/payment-events-admin";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { paymentNotificationStatus } from "@/lib/payment-notify";
import { logOps, type AdminPaymentInteraction } from "@/lib/ops-log";
import { paymentEventInScope } from "@/lib/payment-event-scope";

type Params = { params: Promise<{ id: string }> };

/** POST: 核准付款截圖 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requirePermission(request, "payments:approve");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }
  const { id } = await params;
  let reviewNote: string | null = null;
  let interaction: AdminPaymentInteraction = "click";
  try {
    const body = await request.json().catch(() => ({}));
    reviewNote = typeof body.review_note === "string" ? body.review_note : null;
    if (body.interaction === "keyboard") interaction = "keyboard";
  } catch {
    /* empty body ok */
  }

  try {
    const adminContext = await getAdminContext(request);
    if (!await paymentEventInScope(id, adminContext)) {
      return NextResponse.json({ error: "找不到付款事件" }, { status: 404 });
    }
    const actor = adminContext.user_id || adminContext.email || "admin_session";
    const result = await approvePaymentEvent(id, reviewNote, actor);

    const notification = result.notification ?? null;

    if (!result.already_processed) {
      logOps("admin", "admin.payment_approved", { payment_event_id: id, interaction });
    }
    return NextResponse.json({
      ok: true,
      already_processed: result.already_processed,
      notification: notification
        ? {
            ok: notification.ok,
            status: paymentNotificationStatus(notification),
            error: notification.ok ? undefined : notification.error,
          }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "核准失敗";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
