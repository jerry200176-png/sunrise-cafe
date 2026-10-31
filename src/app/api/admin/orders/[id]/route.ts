import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  if (!branchId) return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  const denied = await requirePermission(request, "orders:read", branchId);
  if (denied) return denied;
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "訂單編號不正確" }, { status: 400 });
  }
  const { data, error } = await adminClient().from("orders").select("id,branch_id,is_printed,status")
    .eq("branch_id", branchId).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "無法核對訂單列印狀態" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "找不到訂單" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = adminClient();
  const found = await db.from("orders").select("branch_id,reservation_id").eq("id", id).maybeSingle();
  if (found.error) return NextResponse.json({ error: found.error.message }, { status: 500 });
  if (!found.data) return NextResponse.json({ error: "找不到訂單" }, { status: 404 });
  const denied = await requirePermission(request, "orders:write", found.data.branch_id);
  if (denied) return denied;
  const body = await request.json();
  const { status, is_printed } = body as { status?: string; is_printed?: boolean };
  if (status && found.data.reservation_id) return NextResponse.json({ error: "訂位餐點請逐項操作" }, { status: 409 });
  if (status && !["pending", "preparing", "ready", "completed", "cancelled"].includes(status)) return NextResponse.json({ error: "狀態不正確" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (is_printed !== undefined) updates.is_printed = is_printed;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "沒有可更新的欄位" }, { status: 400 });
  }

  const { error } = await db.from("orders").update(updates).eq("id", id).eq("branch_id", found.data.branch_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
