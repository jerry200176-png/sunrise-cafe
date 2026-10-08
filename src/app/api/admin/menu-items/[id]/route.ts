import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";
import { setItemOptionSets, syncBranchOptions } from "@/lib/option-sets-db";

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
  const body = await request.json();
  const db = adminClient();
  const found = await db.from("menu_items").select("branch_id").eq("id", id).maybeSingle();
  if (found.error) return NextResponse.json({ error: found.error.message }, { status: 500 });
  if (!found.data) return NextResponse.json({ error: "找不到餐點" }, { status: 404 });
  const denied = await requirePermission(request, "orders:write", found.data.branch_id);
  if (denied) return denied;
  const { name, description, price, image_url, is_available, preorder_eligible, category_id, display_order, option_set_ids } = body;
  if (name !== undefined && (typeof name !== "string" || !name.trim())) return NextResponse.json({ error: "餐點名稱不可為空" }, { status: 400 });
  if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) return NextResponse.json({ error: "價格格式不正確" }, { status: 400 });
  if (category_id) {
    const category = await db.from("menu_categories").select("branch_id").eq("id", category_id).maybeSingle();
    if (category.error || category.data?.branch_id !== found.data.branch_id) return NextResponse.json({ error: "分類不屬於此分店" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = Number(price);
  if (image_url !== undefined) updates.image_url = image_url;
  if (is_available !== undefined) updates.is_available = is_available;
  if (preorder_eligible !== undefined) updates.preorder_eligible = Boolean(preorder_eligible);
  if (category_id !== undefined) updates.category_id = category_id;
  if (display_order !== undefined) updates.display_order = display_order;

  const { error } = await db.from("menu_items").update(updates).eq("id", id).eq("branch_id", found.data.branch_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    if (Array.isArray(option_set_ids)) {
      await setItemOptionSets(db, found.data.branch_id, id, option_set_ids);
    } else if (category_id !== undefined) {
      // 換分類 → 分類上的選項組跟著換
      await syncBranchOptions(db, found.data.branch_id);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "無法套用選項組" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = adminClient();
  const found = await db.from("menu_items").select("branch_id").eq("id", id).maybeSingle();
  if (found.error) return NextResponse.json({ error: found.error.message }, { status: 500 });
  if (!found.data) return NextResponse.json({ error: "找不到餐點" }, { status: 404 });
  const denied = await requirePermission(request, "orders:write", found.data.branch_id);
  if (denied) return denied;
  const { error } = await db.from("menu_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
