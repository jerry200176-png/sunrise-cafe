import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseOrderLines, priceOrderLines, type CatalogRow } from "@/lib/table-order-pricing";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "訂單資料格式不正確" }, { status: 400 });
  }
  const { tableToken, items, notes } = (body ?? {}) as { tableToken?: unknown; items?: unknown; notes?: unknown };

  if (typeof tableToken !== "string" || !tableToken || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "缺少必填欄位" }, { status: 400 });
  }
  // 客人送來的價格、名稱、加價一律不採用；只取 id／數量／選項名稱／備註（#434）。
  const parsed = parseOrderLines(items);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

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

  // 以這間分店的菜單為準重新定價：單價、上架狀態、選項加價都從資料庫取。
  const ids = Array.from(new Set(parsed.value.map((line) => line.menuItemId)));
  const { data: catalog, error: catErr } = await db
    .from("menu_items")
    .select("id,name,price,is_available,options:menu_item_options(id,option_group,option_name,price_delta,set_id,set:menu_option_sets(min_select,max_select))")
    .in("id", ids)
    .eq("branch_id", table.branch_id);
  if (catErr) return NextResponse.json({ error: "無法讀取菜單，請稍後再試" }, { status: 500 });

  const priced = priceOrderLines(parsed.value, (catalog ?? []) as unknown as CatalogRow[]);
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 });

  // 建立訂單
  const { data: order, error: orderErr } = await db
    .from("orders")
    .insert({
      branch_id: table.branch_id,
      table_id: table.id,
      status: "pending",
      total_amount: priced.value.total,
      notes: typeof notes === "string" ? notes.trim().slice(0, 500) || null : null,
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    return NextResponse.json({ error: orderErr?.message ?? "無法建立訂單" }, { status: 500 });
  }

  // 建立訂單明細（全部用伺服器算出的名稱與單價）
  const orderItems = priced.value.lines.map((line) => ({ order_id: order.id, ...line }));

  const { error: itemsErr } = await db.from("order_items").insert(orderItems);
  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orderId: order.id });
}
