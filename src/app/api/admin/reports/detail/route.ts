import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { resolveBranchScope } from "@/lib/rbac";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { taipeiMonthRange } from "@/lib/business-metrics";
import { detailCsv, fetchDetailRows } from "@/lib/report-detail";

/**
 * 做帳用：某個月（台北時間，依訂位開始時間）每筆訂位的金額、結帳與備註，CSV 下載。
 * 權限與分店範圍和 /api/admin/reports 相同（bi:read；外分店 403）。
 */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "bi:read");
  if (denied) return denied;

  const ctx = await getAdminContext(request);
  const scope = resolveBranchScope(ctx, request.nextUrl.searchParams.get("branchId"));
  if (!scope.ok) return NextResponse.json({ error: "Forbidden branch" }, { status: 403 });

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "請選擇月份" }, { status: 400 });
  if (!isAdminConfigured()) return NextResponse.json({ error: "後端未設定" }, { status: 503 });

  const { from, to } = taipeiMonthRange(new Date(`${month}-15T00:00:00+08:00`));
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const rows = await fetchDetailRows(db, scope.scope, from, to);
    return new NextResponse("\uFEFF" + detailCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`昇咖啡訂位明細-${month}.csv`)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "明細暫時讀不到，請重試" }, { status: 500 });
  }
}
