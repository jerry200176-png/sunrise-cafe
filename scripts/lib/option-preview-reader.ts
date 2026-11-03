import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMergePlan, type LegacyOptionRow, type MergePlan } from "../../src/lib/option-set-merge";

const PAGE_SIZE = 500;
type Identified = { id: string };

export function renderOptionPreview(plan: MergePlan, names: Record<string, string>, json: boolean): string {
  return json ? JSON.stringify(plan, null, 2) : formatMergePlan(plan, names);
}

// Do not assume that a short page means EOF: the server's max_rows can be
// smaller than our requested limit. No cross-request snapshot is implied.
async function readPages<T extends Identified>(
  readPage: (after: string | undefined) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await readPage(after);
    if (!page.length) return all;
    for (const row of page) {
      if (typeof row.id !== "string" || (after !== undefined && row.id <= after)) {
        throw new Error("預覽排序不一致，結果可能不完整；請重新執行並使用 SQL 核對");
      }
      after = row.id;
      all.push(row);
    }
  }
}

export async function readOptionPreview(db: SupabaseClient): Promise<{
  rows: LegacyOptionRow[];
  names: Record<string, string>;
}> {
  const options = await readPages(async (after) => {
    let query = db.from("menu_item_options")
      .select("id,item_id,option_group,option_name,price_delta,display_order,item:menu_items(name,branch_id)")
      .is("set_id", null).order("id").limit(PAGE_SIZE);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error || !data) throw new Error("選項查詢失敗；若資料庫尚無 set_id，請使用 SQL 預覽");
    return data;
  });
  const branches = await readPages(async (after) => {
    let query = db.from("branches").select("id,name").order("id").limit(PAGE_SIZE);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error || !data) throw new Error("分店查詢失敗；沒有產生預覽");
    return data;
  });
  const names = Object.fromEntries(branches.map((b) => [b.id, b.name]));
  const rows = options.map((o): LegacyOptionRow => {
    const item = Array.isArray(o.item) ? o.item[0] : o.item;
    const price = Number(o.price_delta);
    if (!item || !item.branch_id || !(item.branch_id in names) || !Number.isFinite(price)) {
      throw new Error("選項關聯或價格無法讀取；沒有產生預覽");
    }
    return { item_id: o.item_id, item_name: item.name, branch_id: item.branch_id,
      option_group: o.option_group, option_name: o.option_name, price_delta: price, display_order: o.display_order };
  });
  return { rows, names };
}
