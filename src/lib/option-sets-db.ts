import type { SupabaseClient } from "@supabase/supabase-js";
import {
  desiredRows,
  limitsToMode,
  modeToLimits,
  planOptionSync,
  validateOptionSetInput,
  type ExistingOptionRow,
  type OptionSetInput,
  type SetDefinition,
} from "@/lib/option-sets";

type SetRow = { id: string; name: string; min_select: number; max_select: number | null; display_order: number };

export type OptionSetView = SetDefinition & { min_select: number; max_select: number | null; mode: string; max_pick: number | null };

export async function loadOptionSets(db: SupabaseClient, branchId: string): Promise<OptionSetView[]> {
  const { data: sets, error } = await db
    .from("menu_option_sets")
    .select("id,name,min_select,max_select,display_order")
    .eq("branch_id", branchId)
    .order("display_order")
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = (sets ?? []) as SetRow[];
  if (rows.length === 0) return [];
  const ids = rows.map((s) => s.id);
  const [opts, items, cats] = await Promise.all([
    db.from("menu_option_set_options").select("id,set_id,name,price_delta,display_order").in("set_id", ids).order("display_order"),
    db.from("menu_option_set_items").select("set_id,item_id").in("set_id", ids),
    db.from("menu_option_set_categories").select("set_id,category_id").in("set_id", ids),
  ]);
  for (const r of [opts, items, cats]) if (r.error) throw new Error(r.error.message);
  return rows.map((s) => ({
    ...s,
    ...limitsToMode(s.min_select, s.max_select),
    options: (opts.data ?? [])
      .filter((o) => o.set_id === s.id)
      .map((o) => ({ id: o.id, name: o.name, price_delta: Number(o.price_delta), display_order: o.display_order })),
    item_ids: (items.data ?? []).filter((i) => i.set_id === s.id).map((i) => i.item_id),
    category_ids: (cats.data ?? []).filter((c) => c.set_id === s.id).map((c) => c.category_id),
  }));
}

/**
 * 讓分店每個餐點的 menu_item_options 與選項組一致（冪等；失敗再呼叫一次即可修復）。
 * 沒有 set_option_id 的舊特例列不動。
 */
export async function syncBranchOptions(db: SupabaseClient, branchId: string): Promise<{ inserted: number; updated: number; removed: number }> {
  const [sets, itemsRes] = await Promise.all([
    loadOptionSets(db, branchId),
    db.from("menu_items").select("id,category_id").eq("branch_id", branchId),
  ]);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  const items = (itemsRes.data ?? []) as Array<{ id: string; category_id: string | null }>;
  if (items.length === 0) return { inserted: 0, updated: 0, removed: 0 };

  const existing: ExistingOptionRow[] = [];
  const itemIds = items.map((i) => i.id);
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data, error } = await db
      .from("menu_item_options")
      .select("id,item_id,set_id,set_option_id,option_group,option_name,price_delta,display_order")
      .in("item_id", itemIds.slice(i, i + 100))
      .not("set_option_id", "is", null);
    if (error) throw new Error(error.message);
    existing.push(...((data ?? []) as ExistingOptionRow[]));
  }

  const plan = planOptionSync(existing, desiredRows(items, sets));
  if (plan.remove.length) {
    for (let i = 0; i < plan.remove.length; i += 100) {
      const { error } = await db.from("menu_item_options").delete().in("id", plan.remove.slice(i, i + 100));
      if (error) throw new Error(error.message);
    }
  }
  if (plan.insert.length) {
    const { error } = await db.from("menu_item_options").insert(plan.insert);
    if (error) throw new Error(error.message);
  }
  for (const u of plan.update) {
    const { error } = await db.from("menu_item_options").update(u.patch).eq("id", u.id);
    if (error) throw new Error(error.message);
  }
  return { inserted: plan.insert.length, updated: plan.update.length, removed: plan.remove.length };
}

async function assertInBranch(db: SupabaseClient, table: "menu_items" | "menu_categories", ids: string[], branchId: string) {
  if (ids.length === 0) return;
  const { data, error } = await db.from(table).select("id").in("id", ids).eq("branch_id", branchId);
  if (error) throw new Error(error.message);
  if ((data ?? []).length !== new Set(ids).size) throw new Error("套用範圍裡有不屬於這間分店的餐點或分類");
}

/** 建立或更新選項組（含選項與套用範圍），最後同步到各餐點。回傳選項組 id。 */
export async function saveOptionSet(db: SupabaseClient, branchId: string, setId: string | null, raw: unknown): Promise<string> {
  const problem = validateOptionSetInput(raw);
  if (problem) throw new Error(problem);
  const input = raw as OptionSetInput;
  const { min_select, max_select } = modeToLimits(input.mode, input.max_pick);
  const itemIds = [...new Set(input.item_ids)];
  const categoryIds = [...new Set(input.category_ids)];
  await assertInBranch(db, "menu_items", itemIds, branchId);
  await assertInBranch(db, "menu_categories", categoryIds, branchId);

  let id = setId;
  if (id) {
    const { data, error } = await db.from("menu_option_sets").update({ name: input.name.trim(), min_select, max_select }).eq("id", id).eq("branch_id", branchId).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("找不到這個選項組");
  } else {
    const { data: last } = await db.from("menu_option_sets").select("display_order").eq("branch_id", branchId).order("display_order", { ascending: false }).limit(1);
    const { data, error } = await db
      .from("menu_option_sets")
      .insert({ branch_id: branchId, name: input.name.trim(), min_select, max_select, display_order: (last?.[0]?.display_order ?? 0) + 1 })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "無法建立選項組");
    id = data.id as string;
  }

  // 選項：有 id 的更新、沒有的新增、不在清單裡的刪除（id 穩定，已選過的不會失效）
  const { data: current, error: curErr } = await db.from("menu_option_set_options").select("id").eq("set_id", id);
  if (curErr) throw new Error(curErr.message);
  const keep = new Set(input.options.map((o) => o.id).filter((x): x is string => Boolean(x)));
  const drop = (current ?? []).map((o) => o.id as string).filter((x) => !keep.has(x));
  if (drop.length) {
    const { error } = await db.from("menu_option_set_options").delete().in("id", drop);
    if (error) throw new Error(error.message);
  }
  const known = new Set((current ?? []).map((o) => o.id as string));
  for (const [index, option] of input.options.entries()) {
    const payload = { name: option.name.trim(), price_delta: option.price_delta, display_order: index };
    const res =
      option.id && known.has(option.id)
        ? await db.from("menu_option_set_options").update(payload).eq("id", option.id)
        : await db.from("menu_option_set_options").insert({ set_id: id, ...payload });
    if (res.error) throw new Error(res.error.message);
  }

  // 套用範圍：整組換掉
  for (const [table, column, values] of [
    ["menu_option_set_items", "item_id", itemIds],
    ["menu_option_set_categories", "category_id", categoryIds],
  ] as const) {
    const del = await db.from(table).delete().eq("set_id", id);
    if (del.error) throw new Error(del.error.message);
    if (values.length) {
      const ins = await db.from(table).insert(values.map((v) => ({ set_id: id, [column]: v })));
      if (ins.error) throw new Error(ins.error.message);
    }
  }

  await syncBranchOptions(db, branchId);
  return id as string;
}

export async function deleteOptionSet(db: SupabaseClient, branchId: string, setId: string): Promise<void> {
  const { data, error } = await db.from("menu_option_sets").delete().eq("id", setId).eq("branch_id", branchId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("找不到這個選項組");
  // menu_item_options 的對應列由外鍵 ON DELETE CASCADE 一併移除；訂單快照是獨立副本，不受影響。
}

/** 餐點直接套用的選項組（餐點表單用）。取代 → 重新指定整組，再同步。 */
export async function setItemOptionSets(db: SupabaseClient, branchId: string, itemId: string, setIds: string[]): Promise<void> {
  const unique = [...new Set(setIds)];
  if (unique.length) {
    const { data, error } = await db.from("menu_option_sets").select("id").in("id", unique).eq("branch_id", branchId);
    if (error) throw new Error(error.message);
    if ((data ?? []).length !== unique.length) throw new Error("選項組不屬於這間分店");
  }
  const del = await db.from("menu_option_set_items").delete().eq("item_id", itemId);
  if (del.error) throw new Error(del.error.message);
  if (unique.length) {
    const ins = await db.from("menu_option_set_items").insert(unique.map((set_id) => ({ set_id, item_id: itemId })));
    if (ins.error) throw new Error(ins.error.message);
  }
  await syncBranchOptions(db, branchId);
}
