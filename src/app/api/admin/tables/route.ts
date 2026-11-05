import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth, requirePermission } from "@/lib/admin-api-auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const authDenied = await requireAdminApiAuth(request);
  if (authDenied) return authDenied;
  const branchId = request.nextUrl.searchParams.get("branchId");
  if (!branchId) {
    return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  }
  const denied = await requirePermission(request, "orders:read", branchId);
  if (denied) return denied;

  const { data, error, count } = await adminClient()
    .from("tables")
    .select("*", { count: "exact" })
    .eq("branch_id", branchId)
    .order("number");

  if (error || !Array.isArray(data) || count === null || data.length !== count) {
    return NextResponse.json({ error: "無法確認完整桌位清單，請稍後再試" }, { status: 503 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const authDenied = await requireAdminApiAuth(request);
  if (authDenied) return authDenied;
  const body = await request.json().catch(() => null) as { branch_id?: unknown; number?: unknown } | null;
  const { branch_id, number } = body ?? {};

  if (typeof branch_id !== "string" || !branch_id.trim() || typeof number !== "string" || !number.trim()) {
    return NextResponse.json({ error: "缺少 branch_id 或桌號" }, { status: 400 });
  }
  const denied = await requirePermission(request, "orders:write", branch_id);
  if (denied) return denied;

  const { data, error } = await adminClient()
    .from("tables")
    .insert({ branch_id, number: number.trim() })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
