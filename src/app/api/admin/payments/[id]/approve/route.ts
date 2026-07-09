import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { approvePaymentEvent } from "@/lib/payment-events-admin";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { sendLineFlex, buildPaymentConfirmedFlex } from "@/lib/line-notify";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type Params = { params: Promise<{ id: string }> };

/** POST: 核准付款截圖 */
export async function POST(request: NextRequest, { params }: Params) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }
  const { id } = await params;
  let reviewNote: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    reviewNote = typeof body.review_note === "string" ? body.review_note : null;
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
        const { data: r } = await db()
          .from("reservations")
          .select("customer_name, booking_code, start_time, end_time, deposit_payment_note")
          .eq("id", event.reservation_id)
          .single();
        if (r) {
          try {
            const flex = buildPaymentConfirmedFlex({
              customerName: r.customer_name,
              bookingCode: r.booking_code,
              startTime: r.start_time,
              endTime: r.end_time,
              rawText: r.deposit_payment_note ?? "後台核准",
            });
            await sendLineFlex(`💰 客人已付訂金：${r.customer_name}`, flex);
          } catch (notifyErr) {
            console.error("[payments/approve] group notify failed:", notifyErr);
          }
        }
      }
    }

    return NextResponse.json({ ok: true, already_processed: result.already_processed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "核准失敗";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
