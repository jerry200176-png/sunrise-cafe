import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDepositAmount } from "@/lib/booking-utils";
import { getAdminContext, requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { assertReservationMessageSendAllowed } from "@/lib/reservation-access";
import {
  fetchReservationMessageBatchContexts,
  recordReservationMessageActions,
} from "@/lib/reservation-message-actions";
import {
  buildBatchReservationMessage,
  formatBatchReservationDate,
  MAX_BATCH_MESSAGE_RESERVATIONS,
  validateBatchReservationContacts,
  type BatchReservationMessageItem,
} from "@/lib/reservation-message-batch";
import { renderReservationMessage, type ReservationMessageTemplateKey } from "@/lib/reservation-message";

type BatchAction = "preview" | "copied";

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function responseForBatch(
  items: BatchReservationMessageItem[],
  batchId: string,
  validation: ReturnType<typeof validateBatchReservationContacts>,
  action: BatchAction,
  extra: Record<string, unknown> = {}
) {
  return {
    ok: action === "preview" || validation.can_batch_copy,
    batch_id: batchId,
    template_key: "deposit_request" as const,
    can_batch_copy: validation.can_batch_copy,
    warnings: validation.warnings,
    items,
    combined_text: buildBatchReservationMessage(items),
    ...extra,
  };
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  let body: {
    reservation_ids?: unknown;
    template_key?: unknown;
    action?: unknown;
    batch_id?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "無效的 JSON" }, { status: 400 });
  }

  if (body.template_key !== "deposit_request") {
    return NextResponse.json({ error: "批次複製目前只支援訂金通知模板" }, { status: 400 });
  }
  const action = body.action as BatchAction;
  if (action !== "preview" && action !== "copied") {
    return NextResponse.json({ error: "非法批次訊息操作" }, { status: 400 });
  }
  if (!Array.isArray(body.reservation_ids)) {
    return NextResponse.json({ error: "請選取至少一筆訂位" }, { status: 400 });
  }

  const reservationIds = body.reservation_ids.map((value) => String(value).trim());
  if (reservationIds.length === 0) {
    return NextResponse.json({ error: "請選取至少一筆訂位" }, { status: 400 });
  }
  if (reservationIds.some((id) => !id)) {
    return NextResponse.json({ error: "訂位 id 不可為空白" }, { status: 400 });
  }
  if (new Set(reservationIds).size !== reservationIds.length) {
    return NextResponse.json({ error: "選取的訂位不可重複" }, { status: 400 });
  }
  if (reservationIds.length > MAX_BATCH_MESSAGE_RESERVATIONS) {
    return NextResponse.json(
      { error: `一次最多選取 ${MAX_BATCH_MESSAGE_RESERVATIONS} 筆訂位` },
      { status: 400 }
    );
  }

  const contexts = await fetchReservationMessageBatchContexts(reservationIds);
  if (contexts.length !== reservationIds.length) {
    return NextResponse.json({ error: "部分訂位不存在、沒有分店或無法重新查詢" }, { status: 404 });
  }

  const adminContext = await getAdminContext(request);
  for (const context of contexts) {
    const rbacDenied = assertReservationMessageSendAllowed(adminContext, context.branchId);
    if (rbacDenied) return NextResponse.json({ error: rbacDenied }, { status: 403 });
  }

  let items: BatchReservationMessageItem[];
  try {
    items = contexts.map((context) => {
      const text = renderReservationMessage(
        "deposit_request" as ReservationMessageTemplateKey,
        context.reservation,
        context.branch
      );
      const total = Number(context.reservation.total_price);
      return {
        reservation_id: context.reservationId,
        customer_name: context.reservation.customer_name,
        date_label: formatBatchReservationDate(context.reservation.start_time),
        start_time: context.reservation.start_time,
        end_time: context.reservation.end_time,
        booking_code: context.reservation.booking_code ?? null,
        deposit_amount: getDepositAmount(total),
        text,
      };
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法產生訂金訊息" },
      { status: 422 }
    );
  }

  const validation = validateBatchReservationContacts(
    contexts.map((context) => ({
      customer_name: context.reservation.customer_name,
      phone: context.phone,
      email: context.email,
      branch_id: context.branchId,
      status: context.status,
    }))
  );
  const isSingleCopy = reservationIds.length === 1;
  const effectiveValidation = isSingleCopy
    ? { can_batch_copy: true, warnings: [] }
    : validation;
  const batchId = isUuid(body.batch_id) ? body.batch_id : randomUUID();
  if (action === "copied" && !effectiveValidation.can_batch_copy) {
    return NextResponse.json(
      responseForBatch(items, batchId, validation, action, { error: "批次複製條件不成立，請改用逐筆複製" }),
      { status: 409 }
    );
  }

  if (action === "copied") {
    try {
      const actionIds = await recordReservationMessageActions(
        items.map((item) => ({
          reservationId: item.reservation_id,
          templateKey: "deposit_request" as const,
          channel: "manual_line" as const,
          action: "copied" as const,
          actorUserId: adminContext.user_id,
          renderedText: item.text,
          batchId,
        }))
      );
      return NextResponse.json(responseForBatch(items, batchId, effectiveValidation, action, { action_ids: actionIds }));
    } catch (error) {
      return NextResponse.json(
        responseForBatch(items, batchId, effectiveValidation, action, {
          error: error instanceof Error ? error.message : "批次 audit 記錄失敗",
        }),
        { status: 500 }
      );
    }
  }

  return NextResponse.json(responseForBatch(items, batchId, validation, action));
}
