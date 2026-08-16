import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { assertReservationMessageSendAllowed } from "@/lib/reservation-access";
import {
  fetchReservationMessageContext,
  isValidReservationMessageTemplate,
  recordReservationMessageAction,
  renderReservationMessageById,
} from "@/lib/reservation-message-actions";
import type { ReservationMessageTemplateKey } from "@/lib/reservation-message";

type RouteContext = { params: Promise<{ id: string }> };

async function authorize(
  request: NextRequest,
  reservationId: string
): Promise<
  | { response: NextResponse }
  | { context: Awaited<ReturnType<typeof getAdminContext>> }
> {
  const denied = await requireAdminApiAuth(request);
  if (denied) return { response: denied };
  if (!isAdminConfigured()) {
    return {
      response: NextResponse.json(
        { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
        { status: 503 }
      ),
    };
  }

  const reservation = await fetchReservationMessageContext(reservationId);
  if (!reservation) {
    return { response: NextResponse.json({ error: "找不到訂位或分店" }, { status: 404 }) };
  }

  const context = await getAdminContext(request);
  const rbacDenied = assertReservationMessageSendAllowed(context, reservation.branchId);
  if (rbacDenied) {
    return { response: NextResponse.json({ error: rbacDenied }, { status: 403 }) };
  }
  return { context };
}

async function renderForRequest(
  request: NextRequest,
  reservationId: string
): Promise<
  | { response: NextResponse }
  | { context: Awaited<ReturnType<typeof getAdminContext>>; text: string; templateKey: ReservationMessageTemplateKey }
> {
  const auth = await authorize(request, reservationId);
  if ("response" in auth) return auth;

  const templateKey = new URL(request.url).searchParams.get("template_key");
  if (!isValidReservationMessageTemplate(templateKey)) {
    return { response: NextResponse.json({ error: "非法訊息模板" }, { status: 400 }) };
  }
  try {
    const rendered = await renderReservationMessageById(reservationId, templateKey);
    if (!rendered) {
      return { response: NextResponse.json({ error: "找不到訂位或分店" }, { status: 404 }) };
    }
    return { context: auth.context, text: rendered.text, templateKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法產生訊息";
    return { response: NextResponse.json({ error: message }, { status: 422 }) };
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const reservationId = (await params).id;
  if (!reservationId) return NextResponse.json({ error: "缺少訂位 id" }, { status: 400 });

  const rendered = await renderForRequest(request, reservationId);
  if ("response" in rendered) return rendered.response;
  return NextResponse.json({ ok: true, template_key: rendered.templateKey, text: rendered.text });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const reservationId = (await params).id;
  if (!reservationId) return NextResponse.json({ error: "缺少訂位 id" }, { status: 400 });

  const auth = await authorize(request, reservationId);
  if ("response" in auth) return auth.response;

  let body: { template_key?: unknown; channel?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "無效的 JSON" }, { status: 400 });
  }

  if (!isValidReservationMessageTemplate(body.template_key)) {
    return NextResponse.json({ error: "非法訊息模板" }, { status: 400 });
  }
  if (body.channel !== "manual_line") {
    return NextResponse.json({ error: "人工工作台只能使用 manual_line" }, { status: 400 });
  }
  if (body.action !== "copied" && body.action !== "manual_sent") {
    return NextResponse.json({ error: "非法訊息操作" }, { status: 400 });
  }

  try {
    const rendered = await renderReservationMessageById(reservationId, body.template_key);
    if (!rendered) {
      return NextResponse.json({ error: "找不到訂位或分店" }, { status: 404 });
    }
    const actionId = await recordReservationMessageAction({
      reservationId,
      templateKey: body.template_key,
      channel: "manual_line",
      action: body.action,
      actorUserId: auth.context.user_id,
      renderedText: rendered.text,
    });
    return NextResponse.json({
      ok: true,
      action_id: actionId,
      template_key: body.template_key,
      action: body.action,
      text: rendered.text,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法產生或記錄訊息";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
