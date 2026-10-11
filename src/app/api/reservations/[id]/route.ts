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
import { markDepositPaid, markDepositUnpaid, updateDepositInfo } from "@/lib/deposit-paid";
import { paymentNotificationStatus, type NotifyPaymentApprovedResult } from "@/lib/payment-notify";
import { requirePreorderReconfirmation } from "@/lib/reservation-preorder";
import {
  intentForStatusChange,
  loadReservation,
  transitionHttp,
  transitionReservation,
  type Intent,
} from "@/lib/reservation-lifecycle";
import { isPostgresExclusionViolation } from "@/lib/slot-conflict";

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
    // Deposit state is owned by lib/deposit-paid; the tracking columns are not patchable.
    const dep: { paid?: boolean; note?: string | null; paidOn?: string | null; lastFive?: string | null } = {};
    if (body.is_deposit_paid !== undefined) dep.paid = Boolean(body.is_deposit_paid);
    if (body.deposit_payment_note !== undefined)
      dep.note = body.deposit_payment_note == null || body.deposit_payment_note === "" ? null : String(body.deposit_payment_note);
    if (body.deposit_paid_on !== undefined) {
      const v = body.deposit_paid_on == null || body.deposit_paid_on === "" ? null : String(body.deposit_paid_on);
      if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json({ error: "匯款日期格式錯誤" }, { status: 400 });
      }
      dep.paidOn = v;
    }
    if (body.deposit_last_five !== undefined) {
      const v = body.deposit_last_five == null || body.deposit_last_five === "" ? null : String(body.deposit_last_five).trim();
      if (v !== null && !/^\d{5}$/.test(v)) {
        return NextResponse.json({ error: "末五碼須為 5 位數字" }, { status: 400 });
      }
      dep.lastFive = v;
    }
    const depKeys = {
      ...(dep.paid !== undefined ? { is_deposit_paid: dep.paid } : {}),
      ...(dep.note !== undefined ? { deposit_payment_note: dep.note } : {}),
      ...(dep.paidOn !== undefined ? { deposit_paid_on: dep.paidOn } : {}),
      ...(dep.lastFive !== undefined ? { deposit_last_five: dep.lastFive } : {}),
    };
    const touchesDeposit = Object.keys(depKeys).length > 0;

    const requestedStatus: string | undefined = typeof body.status === "string" ? body.status : undefined;
    const wantsRestore = body.intent === "restore";
    if (body.status !== undefined && requestedStatus === undefined) {
      return NextResponse.json({ error: "狀態格式錯誤" }, { status: 400 });
    }
    if (body.intent !== undefined && !wantsRestore) {
      return NextResponse.json({ error: "不支援的操作" }, { status: 400 });
    }
    if (Object.keys(patch).length === 0 && !touchesDeposit && requestedStatus === undefined && !wantsRestore) {
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
      Object.keys(patch).length > 0 || touchesDeposit || requestedStatus !== undefined
        ? assertReservationPatchAllowed(
            ctx,
            { ...patch, ...depKeys, ...(requestedStatus !== undefined ? { status: requestedStatus } : {}) },
            branchId
          )
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

    if (touchesDeposit) {
      const evidence = { note: dep.note, paidOn: dep.paidOn, lastFive: dep.lastFive };
      const actor = ctx.user_id ?? ctx.email ?? null;
      if (dep.paid === true) {
        ({ notification: paymentNotification } = await markDepositPaid(id, "admin_patch", evidence, actor));
      } else if (dep.paid === false) {
        await markDepositUnpaid(id, evidence);
      } else {
        await updateDepositInfo(id, evidence);
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
