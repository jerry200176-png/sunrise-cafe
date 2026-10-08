import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { resolveBranchScope } from "@/lib/rbac";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { taipeiMonthRange } from "@/lib/business-metrics";
import { fetchReportRows } from "@/lib/overview-data";
import { buildReport } from "@/lib/report-builder";

/**
 * 營收報表。實收（已付訂金、已結帳餐點）與預計（還沒到的訂位）分開回傳，不加總。
 * 需要登入與 bi:read；分店範圍和其他後台讀取一致（外分店 403，「全部」= 有權限的全部）。
 */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "bi:read");
  if (denied) return denied;

  const ctx = await getAdminContext(request);
  const scope = resolveBranchScope(ctx, request.nextUrl.searchParams.get("branchId"));
  if (!scope.ok) return NextResponse.json({ error: "Forbidden branch" }, { status: 403 });
  if (!isAdminConfigured()) return NextResponse.json({ error: "後端未設定" }, { status: 503 });

  const months = Math.min(24, Math.max(1, Math.trunc(Number(request.nextUrl.searchParams.get("months") ?? "6")) || 6));
  const now = new Date();
  const from = taipeiMonthRange(now, -(months - 1)).from;
  const to = taipeiMonthRange(now, 0).to;

  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { reservations, orders } = await fetchReportRows(db, scope.scope, from, to);
    const multiBranch = scope.scope === null || scope.scope.length !== 1;
    return NextResponse.json(buildReport(reservations, orders, months, now, multiBranch));
  } catch {
    return NextResponse.json({ error: "報表暫時讀不到，請重試" }, { status: 500 });
  }
}
