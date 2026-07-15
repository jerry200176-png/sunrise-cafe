import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { verifyAttendanceToken } from "@/lib/attendance-token";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function loadReservation(id: string) {
  const { data, error } = await db()
    .from("reservations")
    .select(
      "id, booking_code, customer_name, start_time, end_time, status, guest_confirmed_at, is_deposit_paid, room:rooms(name, branch:branches(name))"
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

function formatPayload(r: Record<string, unknown>) {
  const room = r.room as { name?: string; branch?: { name?: string } } | null;
  return {
    id: r.id,
    booking_code: r.booking_code,
    customer_name: r.customer_name,
    start_time: r.start_time,
    end_time: r.end_time,
    status: r.status,
    guest_confirmed_at: r.guest_confirmed_at ?? null,
    is_deposit_paid: !!r.is_deposit_paid,
    room_name: room?.name ?? "—",
    branch_name: room?.branch?.name ?? "—",
  };
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

  const r = await loadReservation(id);
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

  const r = await loadReservation(id);
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
    if (/guest_confirmed_at/i.test(error.message)) {
      return NextResponse.json(
        {
          error:
            "資料庫尚未啟用出席確認欄位，請執行 migration-guest-confirmed-at.sql",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    already: false,
    ...formatPayload({ ...r, guest_confirmed_at: now }),
  });
}
