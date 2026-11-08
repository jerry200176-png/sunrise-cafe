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
    return NextResponse.json({ error: "訂單資料格式不正確", safe_to_retry: true }, { status: 400 });
  }
  const { tableToken, items, notes } = (body ?? {}) as { tableToken?: unknown; items?: unknown; notes?: unknown };

  if (typeof tableToken !== "string" || !tableToken || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "缺少必填欄位", safe_to_retry: true }, { status: 400 });
  }
  // 客人送來的價格、名稱、加價一律不採用；只取 id／數量／選項名稱／備註（#434）。
  const parsed = parseOrderLines(items);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, safe_to_retry: true }, { status: 400 });

  const db = adminClient();

  // 驗證桌位
  const { data: table, error: tableErr } = await db
    .from("tables")
    .select("id, branch_id, is_active, branches(archived_at)")
    .eq("qr_token", tableToken)
    .single();

  if (tableErr || !table) {
    return NextResponse.json({ error: "找不到此桌位", safe_to_retry: true }, { status: 404 });
  }
  if (!table.is_active) {
    return NextResponse.json({ error: "此桌位目前停用", safe_to_retry: true }, { status: 403 });
  }
  const branch = Array.isArray(table.branches) ? table.branches[0] : table.branches;
  if (!branch || !("archived_at" in branch)) return NextResponse.json({ error: "目前無法確認分店狀態", safe_to_retry: true }, { status: 503 });
  if (branch.archived_at !== null) return NextResponse.json({ error: "此分店目前無法點餐", safe_to_retry: true }, { status: 403 });

  // 以這間分店的菜單為準重新定價：單價、上架狀態、選項加價都從資料庫取。
  const ids = Array.from(new Set(parsed.value.map((line) => line.menuItemId)));
  const { data: catalog, error: catErr } = await db
    .from("menu_items")
    .select("id,name,price,is_available,options:menu_item_options(id,option_group,option_name,price_delta,set_id,set:menu_option_sets(min_select,max_select))")
    .in("id", ids)
    .eq("branch_id", table.branch_id);
  if (catErr) return NextResponse.json({ error: "無法讀取菜單，請稍後再試", safe_to_retry: true }, { status: 500 });

  const priced = priceOrderLines(parsed.value, (catalog ?? []) as unknown as CatalogRow[]);
  if (!priced.ok) return NextResponse.json({ error: priced.error, safe_to_retry: true }, { status: priced.priceChanged ? 409 : 400 });

  // The DB transaction locks and rechecks table, branch, catalog and options at
  // the point of insertion. Missing RPC must fail closed; never fall back to
  // separate inserts or trust the browser's price as an authority.
  const result = await db.rpc("create_table_order_checked", {
    p_table_id: table.id, p_branch_id: table.branch_id, p_table_token: tableToken, p_items: priced.value.lines,
    p_notes: typeof notes === "string" ? notes.trim().slice(0, 500) || null : null,
  });
  if (result.error) {
    const message = String(result.error.message ?? "");
    if (result.error.code === "P0001" && message === "qr_catalog_changed") return NextResponse.json({ error: "餐點價格或選項已變更，請先刪除購物車中的舊餐點，再返回菜單重新選擇並確認價格", safe_to_retry: true }, { status: 409 });
    if (result.error.code === "P0001" && ["qr_branch_unavailable", "qr_table_unavailable"].includes(message)) return NextResponse.json({ error: "此桌位目前無法點餐", safe_to_retry: true }, { status: 403 });
    return NextResponse.json({ error: "目前無法確認訂單，請洽店員，暫勿重複送出" }, { status: 503 });
  }
  if (typeof result.data !== "string" || !result.data) return NextResponse.json({ error: "目前無法確認訂單，請洽店員，暫勿重複送出" }, { status: 503 });
  return NextResponse.json({ ok: true, orderId: result.data });
}
