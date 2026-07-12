import { NextRequest, NextResponse } from "next/server";
import { fetchReservationsAdmin, isAdminConfigured } from "@/lib/supabase-admin";

type ReservationRow = {
  start_time: string;
  status: string;
  total_price: number | null;
};

function dayRange(date: string) {
  return {
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`,
  };
}

function lastNDays(endDate: string, n: number): string[] {
  const end = new Date(`${endDate}T12:00:00.000Z`);
  return Array.from({ length: n }, (_, idx) => {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - (n - 1 - idx));
    return d.toISOString().slice(0, 10);
  });
}

/** 7-day booking trend in one DB round-trip (ADM-005). */
export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  const endDate =
    request.nextUrl.searchParams.get("endDate") ??
    request.nextUrl.searchParams.get("date") ??
    new Date().toISOString().slice(0, 10);

  if (!branchId) {
    return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }

  try {
    const reservations = (await fetchReservationsAdmin(branchId)) as ReservationRow[];
    const list = Array.isArray(reservations) ? reservations : [];
    const days = lastNDays(endDate, 7);

    const points = days.map((date) => {
      const { start, end } = dayRange(date);
      const dayList = list.filter(
        (r) => r.status !== "cancelled" && r.start_time >= start && r.start_time <= end
      );
      return {
        date,
        count: dayList.length,
        revenue: Math.round(
          dayList.reduce((sum, r) => sum + (Number(r.total_price) || 0), 0)
        ),
      };
    });

    return NextResponse.json({ endDate, points });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入趨勢";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
