import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { approvePaymentEvent } from "@/lib/payment-events-admin";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/admin-api-auth";
import { notifyPaymentApproved } from "@/lib/payment-notify";
import { logOps, type AdminPaymentInteraction } from "@/lib/ops-log";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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
    const result = await approvePaymentEvent(id, reviewNote);

    if (!result.already_processed) {
      const { data: event } = await db()
        .from("payment_events")
        .select("reservation_id")
        .eq("id", id)
        .single();

      if (event?.reservation_id) {
        await notifyPaymentApproved(event.reservation_id, {
          actor: "admin_payment_event",
          reviewNote,
        });
      }
    }

    if (!result.already_processed) {
      logOps("admin", "admin.payment_approved", { payment_event_id: id, interaction });
    }
    return NextResponse.json({ ok: true, already_processed: result.already_processed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "核准失敗";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
