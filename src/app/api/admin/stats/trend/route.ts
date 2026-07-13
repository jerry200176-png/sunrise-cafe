import { NextRequest, NextResponse } from "next/server";
import { buildDashboardTrend } from "@/lib/admin-dashboard-data";
import { fetchReservationsAdmin, isAdminConfigured } from "@/lib/supabase-admin";

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
    const reservations = await fetchReservationsAdmin(branchId);
    const list = Array.isArray(reservations) ? reservations : [];

    return NextResponse.json(buildDashboardTrend(endDate, list));
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入趨勢";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
