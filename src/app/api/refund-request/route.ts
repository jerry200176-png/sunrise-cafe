import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyGuestBookingById } from "@/lib/guest-auth";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";
import { isAdminConfigured } from "@/lib/supabase-admin";
import {
  DEFAULT_CANCEL_REFUND_POLICY,
  evaluateGuestCancel,
} from "@/lib/cancel-refund-policy";
import { logOps } from "@/lib/ops-log";

/**
 * Guest opens a refund/cancel request for paid deposits.
 * Does not move money — creates audit row for staff.
 */
export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "服務暫時無法使用" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { id, booking_code, phone, reason } = body as {
      id?: string;
      booking_code?: string;
      phone?: string;
      reason?: string;
    };

    if (!id || !booking_code?.trim() || !phone?.trim()) {
      return NextResponse.json({ error: "請提供訂位資料" }, { status: 400 });
    }

    const limited = await enforceGuestLookupLimit(request, phone);
    if (limited) return limited;

    const verified = await verifyGuestBookingById(phone, booking_code, id);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const match = verified.reservation;
    if (!match.is_deposit_paid) {
      return NextResponse.json(
        { error: "此訂位尚未付訂金，請直接取消即可" },
        { status: 400 }
      );
    }

    const decision = evaluateGuestCancel({
      isDepositPaid: true,
      startTimeMs: new Date(match.start_time).getTime(),
    });

    if (!DEFAULT_CANCEL_REFUND_POLICY.allow_refund_request_workflow) {
      return NextResponse.json(
        { error: decision.message ?? "請來電店家協助" },
        { status: 400 }
      );
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await db
      .from("refund_requests")
      .insert({
        reservation_id: match.id,
        status: "requested",
        reason: reason?.trim()?.slice(0, 500) || null,
        actor_type: "guest",
        actor_ref: "phone+code",
      })
      .select("id,status")
      .single();

    if (error) {
      if (error.message?.includes("refund_requests") || error.code === "42P01") {
        return NextResponse.json(
          {
            error: "退費申請功能尚未啟用，請來電店家",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    logOps("guest", "guest.refund_requested", {
      reservation_id: match.id,
      refund_request_id: data?.id,
      eligibility: decision.eligibility,
    });

    return NextResponse.json({
      ok: true,
      id: data?.id,
      status: data?.status ?? "requested",
      message: DEFAULT_CANCEL_REFUND_POLICY.guest_copy.refund_request_ack,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法送出申請";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
