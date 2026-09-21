import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { canAccessBranch } from "@/lib/rbac";
import { fetchDailyPrep } from "@/lib/reservation-preorder";

export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "reservations:read");
  if (denied) return denied;
  const branchId = request.nextUrl.searchParams.get("branchId");
  const date = request.nextUrl.searchParams.get("date");
  if (!branchId || !date) return NextResponse.json({ error: "缺少 branchId/date" }, { status: 400 });
  const ctx = await getAdminContext(request);
  if (!canAccessBranch(ctx, branchId)) return NextResponse.json({ error: "Forbidden branch" }, { status: 403 });
  try { return NextResponse.json(await fetchDailyPrep(branchId, date)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "無法載入備餐清單" }, { status: 500 }); }
}
