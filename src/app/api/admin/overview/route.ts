import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { resolveBranchScope } from "@/lib/rbac";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { loadOverview } from "@/lib/overview-data";

/** 經營總覽。分店範圍和其他後台讀取一致：只給帳號有權限的分店，「全部」= 有權限的全部。 */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "bi:read");
  if (denied) return denied;

  const ctx = await getAdminContext(request);
  const scope = resolveBranchScope(ctx, request.nextUrl.searchParams.get("branchId"));
  if (!scope.ok) {
    return NextResponse.json({ error: "Forbidden branch" }, { status: 403 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    return NextResponse.json(await loadOverview(db, scope.scope));
  } catch {
    return NextResponse.json({ error: "經營總覽暫時讀不到，請重試" }, { status: 500 });
  }
}
