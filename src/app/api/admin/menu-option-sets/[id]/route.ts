import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";
import { deleteOptionSet, saveOptionSet } from "@/lib/option-sets-db";

type Params = { params: Promise<{ id: string }> };
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function branchOf(id: string) {
  const { data } = await db().from("menu_option_sets").select("branch_id").eq("id", id).maybeSingle();
  return (data?.branch_id as string | undefined) ?? null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const branchId = await branchOf(id);
  if (!branchId) return NextResponse.json({ error: "找不到這個選項組" }, { status: 404 });
  const denied = await requirePermission(request, "orders:write", branchId);
  if (denied) return denied;
  try {
    await saveOptionSet(db(), branchId, id, await request.json().catch(() => null));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "無法儲存選項組" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const branchId = await branchOf(id);
  if (!branchId) return NextResponse.json({ error: "找不到這個選項組" }, { status: 404 });
  const denied = await requirePermission(request, "orders:write", branchId);
  if (denied) return denied;
  try {
    await deleteOptionSet(db(), branchId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "無法刪除選項組" }, { status: 500 });
  }
}
