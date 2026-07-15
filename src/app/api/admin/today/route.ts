import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { fetchTodayOpsBundle } from "@/lib/admin-today";

/** Mobile-first 今日場控 bundle */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "reservations:read");
  if (denied) return denied;

  const branchId = request.nextUrl.searchParams.get("branchId");
  const date = request.nextUrl.searchParams.get("date") ?? undefined;
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
    const bundle = await fetchTodayOpsBundle(branchId, date);
    return NextResponse.json(bundle);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入今日場控";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
