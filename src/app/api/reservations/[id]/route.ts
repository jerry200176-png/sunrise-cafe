import { NextRequest, NextResponse } from "next/server";
import { updateReservationAdmin, deleteReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";
import {
  sendLineFlexMessage,
  buildReviewInviteFlex,
} from "@/lib/line";
import { sendDepositPaymentRequest } from "@/lib/payment-request-line";
import { notifyWaitlist } from "@/lib/waitlist";
import { fetchSettings } from "@/lib/supabase-fetch";
import { requireAdminApiAuth, getAdminContext } from "@/lib/admin-api-auth";
import {
  assertReservationPatchAllowed,
  assertReservationCancelAllowed,
} from "@/lib/reservation-access";
import { fetchReservationBranchId } from "@/lib/supabase-admin";
import { logDepositStatusChange } from "@/lib/payment-log";
import { createClient } from "@supabase/supabase-js";
import { deliverLineGuestNotification } from "@/lib/line-guest-delivery";
import { buildGuestBookingCancelledFlex } from "@/lib/line-cards";
import { notifyPaymentApproved } from "@/lib/payment-notify";
function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type RoomWithBranch = { name?: string; branch: { id?: string; name: string }[] }[];
type CancellationNoticeRow = {
  line_user_id?: string | null;
  customer_name?: string | null;
  booking_code?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  room?: { branch?: { name?: string } | { name?: string }[] | null } | { branch?: { name?: string } | { name?: string }[] | null }[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "缺少訂位 id" }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const patch: Parameters<typeof updateReservationAdmin>[1] = {};
    if (body.customer_name !== undefined) patch.customer_name = String(body.customer_name).trim();
    if (body.phone !== undefined) patch.phone = String(body.phone).trim();
    if (body.email !== undefined) patch.email = body.email == null || body.email === "" ? null : String(body.email).trim();
    if (body.start_time !== undefined) patch.start_time = body.start_time;
    if (body.end_time !== undefined) patch.end_time = body.end_time;
    if (body.status !== undefined) patch.status = body.status;
    if (body.total_price !== undefined) patch.total_price = body.total_price == null ? null : Number(body.total_price);
    if (body.guest_count !== undefined) patch.guest_count = body.guest_count == null ? null : Number(body.guest_count);
    if (body.notes !== undefined) patch.notes = body.notes == null || body.notes === "" ? null : String(body.notes).trim();
    if (body.is_deposit_paid !== undefined) patch.is_deposit_paid = Boolean(body.is_deposit_paid);
    if (body.deposit_payment_note !== undefined)
      patch.deposit_payment_note = body.deposit_payment_note == null || body.deposit_payment_note === "" ? null : String(body.deposit_payment_note);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "未提供可更新欄位" }, { status: 400 });
    }

    const branchId = await fetchReservationBranchId(id);
    if (!branchId) {
      return NextResponse.json({ error: "找不到訂位或分店" }, { status: 404 });
    }
    const ctx = await getAdminContext(request);
    const rbacDenied = assertReservationPatchAllowed(ctx, patch, branchId);
    if (rbacDenied) {
      return NextResponse.json({ error: rbacDenied }, { status: 403 });
    }

    const touchesDeposit =
      patch.is_deposit_paid !== undefined || patch.deposit_payment_note !== undefined;
    let beforeRow: {
      is_deposit_paid: boolean;
      deposit_payment_note: string | null;
      status: string;
      booking_code: string;
    } | null = null;

    if (touchesDeposit) {
      const { data } = await supabaseAdmin()
        .from("reservations")
        .select("is_deposit_paid, deposit_payment_note, status, booking_code")
        .eq("id", id)
        .single();
      if (data) beforeRow = data;
    }

    let cancellationNotice: CancellationNoticeRow | null = null;
    if (patch.status === "cancelled") {
      const { data } = await supabaseAdmin()
        .from("reservations")
        .select("line_user_id, customer_name, booking_code, start_time, end_time, room:rooms(branch:branches(name))")
        .eq("id", id)
        .maybeSingle();
      cancellationNotice = data as CancellationNoticeRow | null;
    }

    await updateReservationAdmin(id, patch);

    if (cancellationNotice?.line_user_id) {
      const room = firstRelation(cancellationNotice.room);
      const branch = firstRelation(room?.branch);
      try {
        const result = await deliverLineGuestNotification({
          notificationType: "booking_cancelled",
          reservationId: id,
          recipientId: cancellationNotice.line_user_id,
          send: () =>
            sendLineFlexMessage(
              cancellationNotice.line_user_id!,
              "訂位已取消",
              buildGuestBookingCancelledFlex({
                customerName: cancellationNotice.customer_name ?? "您好",
                branchName: branch?.name ?? "昇咖啡",
                bookingCode: cancellationNotice.booking_code,
                startTime: cancellationNotice.start_time!,
                endTime: cancellationNotice.end_time!,
              })
            ),
        });
        if (result === "error") console.error("[reservations/id] guest cancellation notify failed");
      } catch (err) {
        console.error("[reservations/id] guest cancellation claim failed:", err);
      }
    }

    if (beforeRow && touchesDeposit) {
      const afterPaid =
        patch.is_deposit_paid !== undefined
          ? Boolean(patch.is_deposit_paid)
          : beforeRow.is_deposit_paid;
      const afterNote =
        patch.deposit_payment_note !== undefined
          ? patch.deposit_payment_note
          : beforeRow.deposit_payment_note;

      if (beforeRow.is_deposit_paid !== afterPaid) {
        logDepositStatusChange({
          action: afterPaid ? "deposit.marked_paid" : "deposit.marked_unpaid",
          reservation_id: id,
          booking_code: beforeRow.booking_code,
          actor_type: "admin_session",
          before: {
            is_deposit_paid: beforeRow.is_deposit_paid,
            deposit_payment_note: beforeRow.deposit_payment_note,
            status: beforeRow.status,
          },
          after: {
            is_deposit_paid: afterPaid,
            deposit_payment_note: afterNote,
            status: patch.status ?? beforeRow.status,
          },
        });
        if (afterPaid) {
          notifyPaymentApproved(id, {
            actor: "admin_session",
            reviewNote: afterNote,
          }).catch((err) =>
            console.error("[reservations/id] notifyPaymentApproved failed:", err)
          );
        }
      } else if (
        patch.deposit_payment_note !== undefined &&
        beforeRow.deposit_payment_note !== afterNote
      ) {
        logDepositStatusChange({
          action: "deposit.note_updated",
          reservation_id: id,
          booking_code: beforeRow.booking_code,
          actor_type: "admin_session",
          before: {
            is_deposit_paid: beforeRow.is_deposit_paid,
            deposit_payment_note: beforeRow.deposit_payment_note,
          },
          after: {
            is_deposit_paid: afterPaid,
            deposit_payment_note: afterNote,
          },
        });
      }
    }

    // 後台取消時，通知等位清單
    if (patch.status === "cancelled") {
      const { data: cancelled } = await supabaseAdmin()
        .from("reservations")
        .select("room_id, start_time, end_time")
        .eq("id", id)
        .single();
      if (cancelled) {
        notifyWaitlist(cancelled.room_id, cancelled.start_time, cancelled.end_time).catch(
          (err) => console.error("[reservations/id] waitlist notify failed:", err)
        );
      }
    }

    // 確認訂位 or 填金額時：自動推一次繳費通知（已送過則略過，避免雙則相同訊息）
    const triggerLine = patch.status === "confirmed" || patch.total_price !== undefined;
    let lineResult: string | null = null;
    if (triggerLine) {
      const { result, detail } = await sendDepositPaymentRequest(id, {
        force: false,
        actorUserId: ctx.user_id,
      });
      lineResult = detail ? `${result}: ${detail}` : result;
      if (result === "error") {
        console.error("[confirm] LINE 推播失敗:", detail);
      }
    }

    // 結帳時，若客人已綁定 LINE 且尚未邀評過，自動發送 Google 評論邀請
    if (patch.status === "completed") {
      try {
        const { data: r } = await supabaseAdmin()
          .from("reservations")
          .select(`
            line_user_id,
            customer_name,
            review_invited_at,
            room_with_branch:rooms(branch:branches(name))
          `)
          .eq("id", id)
          .single();

        if (r?.line_user_id && !r.review_invited_at) {
          const settings = await fetchSettings();
          if (settings.google_review_url) {
            const roomInfo = (r.room_with_branch as RoomWithBranch | null)?.[0];
            const branchName = (roomInfo?.branch ?? [])[0]?.name ?? "";
            const flex = buildReviewInviteFlex({
              customerName: r.customer_name,
              branchName,
              reviewUrl: settings.google_review_url,
            });
            await sendLineFlexMessage(r.line_user_id, "感謝光臨昇昇咖啡", flex);
            await updateReservationAdmin(id, { review_invited_at: new Date().toISOString() });
          }
        }
      } catch (err) {
        console.error("[reservations/id] 評論邀請發送失敗:", err);
      }
    }

    return NextResponse.json({ ok: true, lineResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新訂位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "缺少訂位 id" }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const branchId = await fetchReservationBranchId(id);
    if (!branchId) {
      return NextResponse.json({ error: "找不到訂位或分店" }, { status: 404 });
    }
    const ctx = await getAdminContext(request);
    const rbacDenied = assertReservationCancelAllowed(ctx, branchId);
    if (rbacDenied) {
      return NextResponse.json({ error: rbacDenied }, { status: 403 });
    }

    await deleteReservationAdmin(id);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法刪除訂位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
