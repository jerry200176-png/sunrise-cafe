import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { verifyAttendanceToken } from "@/lib/attendance-token";
import { signLookupToken } from "@/lib/lookup-token";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import {
  sendLineFlex,
  sendLineFlexToGroup,
  buildGuestAttendanceConfirmedGroupFlex,
} from "@/lib/line-notify";
import { sendLineFlexMessage } from "@/lib/line";
import { buildGuestAttendanceConfirmedFlex } from "@/lib/line-cards";
import { deliverLineGuestNotification } from "@/lib/line-guest-delivery";
import { stableLineRetryKey } from "@/lib/line-retry-key";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type BranchInfo = { name?: string; line_group_id?: string | null };
type RoomInfo = { name?: string; branch?: BranchInfo | BranchInfo[] | null };

type ReservationLoad = {
  reservation: Record<string, unknown> | null;
  error: unknown | null;
};

function logDatabaseError(operation: string, error: unknown) {
  const value = error as { code?: unknown; status?: unknown } | null;
  console.error(`[confirm-attendance] ${operation} failed`, {
    code: typeof value?.code === "string" ? value.code : "unknown",
    status: typeof value?.status === "number" ? value.status : "unknown",
  });
}

function databaseUnavailable() {
  return NextResponse.json(
    { error: "目前無法確認出席，請稍後再試" },
    { status: 503 }
  );
}

async function loadReservation(id: string): Promise<ReservationLoad> {
  const { data, error } = await db()
    .from("reservations")
    .select(
      "id, booking_code, customer_name, phone, line_user_id, start_time, end_time, status, guest_confirmed_at, is_deposit_paid, room:rooms(name, branch:branches(name, line_group_id))"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logDatabaseError("reservation lookup", error);
    return { reservation: null, error };
  }
  return { reservation: data as Record<string, unknown> | null, error: null };
}

function roomBranch(r: Record<string, unknown>): { roomName: string; branchName: string; lineGroupId: string | null } {
  const roomRaw = r.room as RoomInfo | RoomInfo[] | null;
  const room = Array.isArray(roomRaw) ? roomRaw[0] : roomRaw;
  const branchRaw = room?.branch;
  const branch = Array.isArray(branchRaw) ? branchRaw[0] : branchRaw;
  return {
    roomName: room?.name ?? "—",
    branchName: branch?.name ?? "—",
    lineGroupId: branch?.line_group_id?.trim() || null,
  };
}

function formatPayload(r: Record<string, unknown>) {
  const { roomName, branchName } = roomBranch(r);
  const reservationId = String(r.id);
  return {
    id: r.id,
    booking_code: r.booking_code,
    customer_name: r.customer_name,
    start_time: r.start_time,
    end_time: r.end_time,
    status: r.status,
    guest_confirmed_at: r.guest_confirmed_at ?? null,
    is_deposit_paid: !!r.is_deposit_paid,
    room_name: roomName,
    branch_name: branchName,
    lookup_token: signLookupToken(reservationId),
  };
}

async function notifyStaffAttendance(r: Record<string, unknown>) {
  const { roomName, lineGroupId } = roomBranch(r);
  const flex = buildGuestAttendanceConfirmedGroupFlex({
    customerName: String(r.customer_name ?? ""),
    phone: String(r.phone ?? ""),
    bookingCode: String(r.booking_code ?? ""),
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    roomLabel: roomName,
  });
  const alt = `客人已確認出席：${r.customer_name}`;
  try {
    if (lineGroupId) {
      await sendLineFlexToGroup(alt, flex, lineGroupId, {
        retryKey: stableLineRetryKey("attendance-confirmed-group", String(r.id)),
      });
    } else {
      await sendLineFlex(alt, flex, {
        retryKey: stableLineRetryKey("attendance-confirmed-group", String(r.id)),
      });
    }
  } catch (err) {
    console.error("[confirm-attendance] staff LINE notify failed:", err);
  }
}

async function notifyGuestAttendance(r: Record<string, unknown>, lookupToken: string) {
  if (!r.line_user_id) return;
  const { branchName } = roomBranch(r);
  try {
    await deliverLineGuestNotification({
      notificationType: "attendance_confirmed",
      reservationId: String(r.id),
      recipientId: String(r.line_user_id),
      send: () =>
        sendLineFlexMessage(
          String(r.line_user_id),
          "已確認到店",
          buildGuestAttendanceConfirmedFlex({
            customerName: String(r.customer_name ?? "您好"),
            branchName,
            bookingCode: r.booking_code == null ? null : String(r.booking_code),
            startTime: String(r.start_time),
            endTime: String(r.end_time),
            lookupToken,
          }),
          {
            retryKey: stableLineRetryKey(
              "attendance-confirmed-guest",
              String(r.id),
              String(r.line_user_id)
            ),
            reservationId: String(r.id),
          }
        ),
    });
  } catch (err) {
    console.error("[confirm-attendance] guest LINE notify failed:", err);
  }
}

/** GET ?token= — preview booking for confirm page */
export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }
  const { success } = await rateLimit(getClientIp(request), "guestLookup");
  if (!success) return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });

  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  const id = verifyAttendanceToken(token);
  if (!id) return NextResponse.json({ error: "連結無效或已失效" }, { status: 400 });

  const loaded = await loadReservation(id);
  if (loaded.error) return databaseUnavailable();
  const r = loaded.reservation;
  if (!r) return NextResponse.json({ error: "找不到訂位" }, { status: 404 });
  if (r.status === "cancelled") {
    return NextResponse.json({ error: "此訂位已取消", status: "cancelled" }, { status: 410 });
  }
  return NextResponse.json(formatPayload(r));
}

/** POST { token } — mark guest_confirmed_at */
export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }
  const { success } = await rateLimit(getClientIp(request), "guestLookup");
  if (!success) return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });

  let token = "";
  try {
    const body = (await request.json()) as { token?: string };
    token = body.token?.trim() ?? "";
  } catch {
    return NextResponse.json({ error: "無效的請求" }, { status: 400 });
  }

  const id = verifyAttendanceToken(token);
  if (!id) return NextResponse.json({ error: "連結無效或已失效" }, { status: 400 });

  const loaded = await loadReservation(id);
  if (loaded.error) return databaseUnavailable();
  const r = loaded.reservation;
  if (!r) return NextResponse.json({ error: "找不到訂位" }, { status: 404 });
  if (r.status === "cancelled") {
    return NextResponse.json({ error: "此訂位已取消" }, { status: 410 });
  }
  if (r.guest_confirmed_at) {
    return NextResponse.json({ ok: true, already: true, ...formatPayload(r) });
  }

  const now = new Date().toISOString();
  const { error } = await db()
    .from("reservations")
    .update({ guest_confirmed_at: now })
    .eq("id", id);

  if (error) {
    logDatabaseError("reservation update", error);
    return databaseUnavailable();
  }

  const updated = { ...r, guest_confirmed_at: now };
  const payload = formatPayload(updated);
  // Fire-and-forget staff notify — don't block guest response
  void notifyStaffAttendance(updated);
  void notifyGuestAttendance(updated, String(payload.lookup_token));

  return NextResponse.json({
    ok: true,
    already: false,
    ...payload,
  });
}
