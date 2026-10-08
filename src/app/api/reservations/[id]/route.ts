import { NextRequest, NextResponse } from "next/server";
import { updateReservationAdmin, deleteReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";
import { sendDepositPaymentRequest } from "@/lib/payment-request-line";
import { requireAdminApiAuth, getAdminContext } from "@/lib/admin-api-auth";
import {
  assertReservationPatchAllowed,
  assertReservationCancelAllowed,
  assertReservationRestoreAllowed,
} from "@/lib/reservation-access";
import { fetchReservationBranchId, fetchRoom } from "@/lib/supabase-admin";
import { logDepositStatusChange } from "@/lib/payment-log";
import { createClient } from "@supabase/supabase-js";
import { notifyPaymentApproved, paymentNotificationStatus, type NotifyPaymentApprovedResult } from "@/lib/payment-notify";
import { requirePreorderReconfirmation } from "@/lib/reservation-preorder";
import {
  intentForStatusChange,
  loadReservation,
  transitionHttp,
  transitionReservation,
  type Intent,
} from "@/lib/reservation-lifecycle";
import { isPostgresExclusionViolation } from "@/lib/slot-conflict";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
    if (body.room_id !== undefined) patch.room_id = String(body.room_id);
    if (body.total_price !== undefined) patch.total_price = body.total_price == null ? null : Number(body.total_price);
    if (body.guest_count !== undefined) patch.guest_count = body.guest_count == null ? null : Number(body.guest_count);
    if (body.notes !== undefined) patch.notes = body.notes == null || body.notes === "" ? null : String(body.notes).trim();
    if (body.is_deposit_paid !== undefined) patch.is_deposit_paid = Boolean(body.is_deposit_paid);
    if (body.deposit_payment_note !== undefined)
      patch.deposit_payment_note = body.deposit_payment_note == null || body.deposit_payment_note === "" ? null : String(body.deposit_payment_note);
    if (body.deposit_paid_on !== undefined) {
      const v = body.deposit_paid_on == null || body.deposit_paid_on === "" ? null : String(body.deposit_paid_on);
      if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json({ error: "匯款日期格式錯誤" }, { status: 400 });
      }
      patch.deposit_paid_on = v;
    }
    if (body.deposit_last_five !== undefined) {
      const v = body.deposit_last_five == null || body.deposit_last_five === "" ? null : String(body.deposit_last_five).trim();
      if (v !== null && !/^\d{5}$/.test(v)) {
        return NextResponse.json({ error: "末五碼須為 5 位數字" }, { status: 400 });
      }
      patch.deposit_last_five = v;
    }
    if (body.deposit_approved_notified_at !== undefined)
      patch.deposit_approved_notified_at = body.deposit_approved_notified_at == null || body.deposit_approved_notified_at === "" ? null : String(body.deposit_approved_notified_at);
    if (body.deposit_approved_claim_at !== undefined)
      patch.deposit_approved_claim_at = body.deposit_approved_claim_at == null || body.deposit_approved_claim_at === "" ? null : String(body.deposit_approved_claim_at);
    if (body.deposit_approved_retry_key !== undefined)
      patch.deposit_approved_retry_key = body.deposit_approved_retry_key == null || body.deposit_approved_retry_key === "" ? null : String(body.deposit_approved_retry_key);
    if (body.deposit_approved_guest_retry_key !== undefined)
      patch.deposit_approved_guest_retry_key = body.deposit_approved_guest_retry_key == null || body.deposit_approved_guest_retry_key === "" ? null : String(body.deposit_approved_guest_retry_key);
    if (body.deposit_approved_retry_key_created_at !== undefined)
      patch.deposit_approved_retry_key_created_at = body.deposit_approved_retry_key_created_at == null || body.deposit_approved_retry_key_created_at === "" ? null : String(body.deposit_approved_retry_key_created_at);

    const requestedStatus: string | undefined = typeof body.status === "string" ? body.status : undefined;
    const wantsRestore = body.intent === "restore";
    if (body.status !== undefined && requestedStatus === undefined) {
      return NextResponse.json({ error: "狀態格式錯誤" }, { status: 400 });
    }
    if (body.intent !== undefined && !wantsRestore) {
      return NextResponse.json({ error: "不支援的操作" }, { status: 400 });
    }
    if (Object.keys(patch).length === 0 && requestedStatus === undefined && !wantsRestore) {
      return NextResponse.json({ error: "未提供可更新欄位" }, { status: 400 });
    }

    const branchId = await fetchReservationBranchId(id);
    if (!branchId) {
      return NextResponse.json({ error: "找不到訂位或分店" }, { status: 404 });
    }
    if (patch.room_id !== undefined) {
      const targetRoom = await fetchRoom(patch.room_id);
      if (!targetRoom || targetRoom.branch_id !== branchId) {
        return NextResponse.json({ error: "包廂不存在或不屬於目前分店" }, { status: 400 });
      }
    }
    const ctx = await getAdminContext(request);
    const rbacDenied =
      Object.keys(patch).length > 0 || requestedStatus !== undefined
        ? assertReservationPatchAllowed(ctx, requestedStatus !== undefined ? { ...patch, status: requestedStatus } : patch, branchId)
        : null;
    if (rbacDenied) {
      return NextResponse.json({ error: rbacDenied }, { status: 403 });
    }
    if (wantsRestore) {
      const restoreDenied = assertReservationRestoreAllowed(ctx, branchId);
      if (restoreDenied) return NextResponse.json({ error: restoreDenied }, { status: 403 });
    }

    // Status changes go through the lifecycle module; validate before writing anything.
    let intent: Intent | null = wantsRestore ? { type: "restore" } : null;
    if (requestedStatus !== undefined && !wantsRestore) {
      const current = await loadReservation(id);
      if (!current) return NextResponse.json({ error: "找不到訂位" }, { status: 404 });
      const planned = intentForStatusChange(current.status, requestedStatus);
      if ("error" in planned) return NextResponse.json({ error: planned.error }, { status: 409 });
      if ("intent" in planned) intent = planned.intent;
    }

    const touchesDepositInfo =
      patch.deposit_payment_note !== undefined ||
      patch.deposit_paid_on !== undefined ||
      patch.deposit_last_five !== undefined;
    const touchesDeposit = patch.is_deposit_paid !== undefined || touchesDepositInfo;
    let beforeRow: {
      is_deposit_paid: boolean;
      deposit_payment_note: string | null;
      deposit_paid_on: string | null;
      deposit_last_five: string | null;
      deposit_approved_notified_at?: string | null;
      status: string;
      booking_code: string;
    } | null = null;

    if (touchesDeposit) {
      const { data } = await supabaseAdmin()
        .from("reservations")
        .select("is_deposit_paid, deposit_payment_note, deposit_paid_on, deposit_last_five, deposit_approved_notified_at, status, booking_code")
        .eq("id", id)
        .single();
      if (data) beforeRow = data;
    }

    if (Object.keys(patch).length > 0) await updateReservationAdmin(id, patch);

    let paymentNotification: NotifyPaymentApprovedResult | null = null;

    if (
      patch.start_time !== undefined || patch.end_time !== undefined ||
      patch.guest_count !== undefined || patch.room_id !== undefined
    ) {
      await requirePreorderReconfirmation(id, "admin_reservation_change", ctx.user_id ?? ctx.role);
    }

    let lineResult: string | null = null;
    if (intent) {
      const result = await transitionReservation(id, intent, { kind: "admin", userId: ctx.user_id, label: ctx.role });
      if (!result.ok) {
        const { status, body } = transitionHttp(result);
        return NextResponse.json(body, { status });
      }
      lineResult = result.lineResult ?? null;
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
      const afterPaidOn =
        patch.deposit_paid_on !== undefined ? patch.deposit_paid_on : beforeRow.deposit_paid_on;
      const afterLastFive =
        patch.deposit_last_five !== undefined ? patch.deposit_last_five : beforeRow.deposit_last_five;

      if (beforeRow.is_deposit_paid !== afterPaid) {
        logDepositStatusChange({
          action: afterPaid ? "deposit.marked_paid" : "deposit.marked_unpaid",
          reservation_id: id,
          booking_code: beforeRow.booking_code,
          actor_type: "admin_session",
          before: {
            is_deposit_paid: beforeRow.is_deposit_paid,
            deposit_payment_note: beforeRow.deposit_payment_note,
            deposit_paid_on: beforeRow.deposit_paid_on,
            deposit_last_five: beforeRow.deposit_last_five,
            status: beforeRow.status,
          },
          after: {
            is_deposit_paid: afterPaid,
            deposit_payment_note: afterNote,
            deposit_paid_on: afterPaidOn,
            deposit_last_five: afterLastFive,
            status: requestedStatus ?? beforeRow.status,
          },
        });
        if (afterPaid) {
          try {
            paymentNotification = await notifyPaymentApproved(id, {
              actor: "admin_session",
              reviewNote: afterNote,
              manualApproval: true,
            });
          } catch (err) {
            console.error("[reservations/id] notifyPaymentApproved failed:", err);
            paymentNotification = { ok: false, error: "notification_dispatch_failed" };
          }
        }
      } else if (
        afterPaid &&
        patch.is_deposit_paid !== undefined &&
        !beforeRow.deposit_approved_notified_at
      ) {
        // Retry path: already marked paid, but notification previously failed/timed out
        try {
          paymentNotification = await notifyPaymentApproved(id, {
            actor: "admin_session",
            reviewNote: afterNote,
            manualApproval: true,
          });
        } catch (err) {
          console.error("[reservations/id] notifyPaymentApproved retry failed:", err);
          paymentNotification = { ok: false, error: "notification_dispatch_failed" };
        }
      } else if (
        touchesDepositInfo &&
        (beforeRow.deposit_payment_note !== afterNote ||
          beforeRow.deposit_paid_on !== afterPaidOn ||
          beforeRow.deposit_last_five !== afterLastFive)
      ) {
        logDepositStatusChange({
          action: "deposit.note_updated",
          reservation_id: id,
          booking_code: beforeRow.booking_code,
          actor_type: "admin_session",
          before: {
            is_deposit_paid: beforeRow.is_deposit_paid,
            deposit_payment_note: beforeRow.deposit_payment_note,
            deposit_paid_on: beforeRow.deposit_paid_on,
            deposit_last_five: beforeRow.deposit_last_five,
          },
          after: {
            is_deposit_paid: afterPaid,
            deposit_payment_note: afterNote,
            deposit_paid_on: afterPaidOn,
            deposit_last_five: afterLastFive,
          },
        });
      }
    }

    // Filling in the amount: push the payment request once (skipped if already sent).
    if (patch.total_price !== undefined && lineResult === null) {
      const { result, detail } = await sendDepositPaymentRequest(id, {
        force: false,
        actorUserId: ctx.user_id,
      });
      lineResult = detail ? `${result}: ${detail}` : result;
      if (result === "error") console.error("[confirm] LINE 推播失敗:", detail);
    }

    return NextResponse.json({
      ok: true,
      lineResult,
      paymentNotification: paymentNotification
        ? {
            ok: paymentNotification.ok,
            status: paymentNotificationStatus(paymentNotification),
            error: paymentNotification.ok ? undefined : paymentNotification.error,
          }
        : null,
    });
  } catch (err) {
    if (isPostgresExclusionViolation(err)) {
      return NextResponse.json({ error: "該時段已被預訂，無法還原" }, { status: 409 });
    }
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
