import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  const { branch_id, category_id, name, description, price, image_url, display_order, options } =
    body;

  if (!branch_id || !name || price === undefined) {
    return NextResponse.json({ error: "缺少必填欄位（branch_id, name, price）" }, { status: 400 });
  }

  const db = adminClient();
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
    })
    .select("id")
    .single();

  if (error || !item) {
    return NextResponse.json({ error: error?.message ?? "無法新增餐點" }, { status: 500 });
  }

  // 新增選項
  if (Array.isArray(options) && options.length > 0) {
    const rows = options.map(
      (opt: { option_group: string; option_name: string; price_delta?: number; display_order?: number }, idx: number) => ({
        item_id: item.id,
        option_group: opt.option_group,
        option_name: opt.option_name,
        price_delta: opt.price_delta ?? 0,
        display_order: opt.display_order ?? idx,
      })
    );
    await db.from("menu_item_options").insert(rows);
  }

  return NextResponse.json({ ok: true, id: item.id });
}
