import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  if (!branchId) {
    return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  }
  const denied = await requirePermission(request, "orders:read", branchId);
  if (denied) return denied;

  const { data, error } = await adminClient()
    .from("menu_items")
    .select("*, category:menu_categories(name), options:menu_item_options(*)")
    .eq("branch_id", branchId)
    .order("display_order");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { branch_id, category_id, name, description, price, image_url, display_order, preorder_eligible, options } =
    body;

  if (typeof branch_id !== "string" || typeof name !== "string" || !name.trim() || price === undefined) {
    return NextResponse.json({ error: "缺少必填欄位（branch_id, name, price）" }, { status: 400 });
  }
  const denied = await requirePermission(request, "orders:write", branch_id);
  if (denied) return denied;
  if (!Number.isFinite(Number(price)) || Number(price) < 0 || !Array.isArray(options ?? [])) {
    return NextResponse.json({ error: "價格或選項格式不正確" }, { status: 400 });
  }

  const db = adminClient();
  if (category_id) {
    const category = await db.from("menu_categories").select("branch_id").eq("id", category_id).maybeSingle();
    if (category.error || category.data?.branch_id !== branch_id) return NextResponse.json({ error: "分類不屬於此分店" }, { status: 400 });
  }
  const { data: item, error } = await db
    .from("menu_items")
    .insert({
      branch_id,
      category_id: category_id || null,
      name: name.trim(),
      description: description?.trim() || null,
      price: Number(price),
      image_url: image_url || null,
      display_order: display_order ?? 0,
      preorder_eligible: Boolean(preorder_eligible),
    })
    .select("id")
    .single();

  if (error || !item) {
    return NextResponse.json({ error: error?.message ?? "無法新增餐點" }, { status: 500 });
  }

  // 新增選項
  if (Array.isArray(options) && options.length > 0) {
    const result = await db.rpc("replace_menu_item_options", { p_item_id: item.id, p_options: options });
    if (result.error) {
      await db.from("menu_items").delete().eq("id", item.id);
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, id: item.id });
}
