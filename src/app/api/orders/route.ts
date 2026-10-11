import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { CartItem } from "@/types";
import { checkOptionSelection, type RuleOption } from "@/lib/option-sets";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { tableToken, items, notes } = body as {
    tableToken: string;
    items: CartItem[];
    notes?: string;
  };

  if (!tableToken || !items || items.length === 0) {
    return NextResponse.json({ error: "缺少必填欄位" }, { status: 400 });
  }

  const db = adminClient();

  // 驗證桌位
  const { data: table, error: tableErr } = await db
    .from("tables")
    .select("id, branch_id, is_active")
    .eq("qr_token", tableToken)
    .single();

  if (tableErr || !table) {
    return NextResponse.json({ error: "找不到此桌位" }, { status: 404 });
  }
  if (!table.is_active) {
    return NextResponse.json({ error: "此桌位目前停用" }, { status: 403 });
  }

  // 伺服器端驗證選項：必選的要選、不能超過上限（選項以 組名+名稱 對回這間分店該餐點的選項列）
  const { data: catalog, error: catErr } = await db
    .from("menu_items")
    .select("id,name,is_available,options:menu_item_options(id,option_group,option_name,set_id,set:menu_option_sets(min_select,max_select))")
    .in("id", items.map((ci) => ci.menuItem.id))
    .eq("branch_id", table.branch_id);
  if (catErr) return NextResponse.json({ error: catErr.message }, { status: 500 });
  type CatalogRow = { id: string; name: string; is_available: boolean; options: Array<RuleOption & { option_name: string }> };
  const byId = new Map(((catalog ?? []) as unknown as CatalogRow[]).map((row) => [row.id, row]));
  for (const ci of items) {
    const row = byId.get(ci.menuItem.id);
    if (!row || !row.is_available) return NextResponse.json({ error: "部分餐點目前無法點餐" }, { status: 400 });
    const picked = (ci.selectedOptions ?? []).map((o) => row.options.find((opt) => opt.option_group === o.group && opt.option_name === o.name)?.id ?? "?");
    const problem = checkOptionSelection(row.options, picked);
    if (problem) return NextResponse.json({ error: `${row.name}：${problem}` }, { status: 400 });
  }

  // 計算總金額
  const total = items.reduce((sum, ci) => {
    const optionsDelta = ci.selectedOptions.reduce((d, o) => d + (o.delta ?? 0), 0);
    return sum + (ci.menuItem.price + optionsDelta) * ci.quantity;
  }, 0);

  // 建立訂單
  const { data: order, error: orderErr } = await db
    .from("orders")
    .insert({
      branch_id: table.branch_id,
      table_id: table.id,
      status: "pending",
      total_amount: total,
      notes: notes?.trim() || null,
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    return NextResponse.json({ error: orderErr?.message ?? "無法建立訂單" }, { status: 500 });
  }

  // 建立訂單明細
  const orderItems = items.map((ci) => ({
    order_id: order.id,
    menu_item_id: ci.menuItem.id,
    item_name: ci.menuItem.name,
    quantity: ci.quantity,
    unit_price: ci.menuItem.price,
    selected_options: ci.selectedOptions.length > 0 ? ci.selectedOptions : null,
    special_notes: ci.specialNotes?.trim() || null,
  }));

  const { error: itemsErr } = await db.from("order_items").insert(orderItems);
  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orderId: order.id });
}
