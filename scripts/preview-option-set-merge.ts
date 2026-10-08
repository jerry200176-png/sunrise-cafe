/**
 * 唯讀預覽：既有的餐點選項會被合併成哪些選項組。不寫入任何資料。
 *   npx tsx scripts/preview-option-set-merge.ts
 * 需要環境變數 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（只做 SELECT）。
 * 沒有金鑰時，可改在 Supabase SQL Editor 貼上 supabase/preview-menu-option-set-merge.sql。
 */
import { createClient } from "@supabase/supabase-js";
import { formatMergePlan, planOptionSetMerge, type LegacyOptionRow } from "../src/lib/option-set-merge";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（只讀）");
  const db = createClient(url, key);
  const [options, branches] = await Promise.all([
    db.from("menu_item_options").select("item_id,option_group,option_name,price_delta,display_order,item:menu_items(name,branch_id)"),
    db.from("branches").select("id,name"),
  ]);
  if (options.error) throw new Error(options.error.message);
  if (branches.error) throw new Error(branches.error.message);
  const rows: LegacyOptionRow[] = (options.data ?? []).flatMap((o) => {
    const item = Array.isArray(o.item) ? o.item[0] : o.item;
    return item
      ? [{ item_id: o.item_id, item_name: item.name, branch_id: item.branch_id, option_group: o.option_group, option_name: o.option_name, price_delta: Number(o.price_delta), display_order: o.display_order }]
      : [];
  });
  const names = Object.fromEntries((branches.data ?? []).map((b) => [b.id, b.name]));
  const plan = planOptionSetMerge(rows);
  console.log(process.argv.includes("--json") ? JSON.stringify(plan, null, 2) : formatMergePlan(plan, names));
  console.log("\n（預覽完成，沒有寫入任何資料）");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
