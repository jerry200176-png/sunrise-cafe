import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
