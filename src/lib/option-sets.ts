/**
 * 選項組（modifier sets）— 純函式。
 * 選項組是範本；每個餐點實際可選的項目是 menu_item_options 的列，由 planOptionSync 算出差異後同步。
 * 以 set_option_id 為鍵，所以選項 id 在編輯選項組時保持穩定（購物車、預點草稿不會失效）。
 */

export type SetMode = "required_one" | "optional_one" | "multi";

export const MODE_LABELS: Record<SetMode, string> = {
  required_one: "必選一個",
  optional_one: "可不選（最多一個）",
  multi: "可多選",
};

export function modeToLimits(mode: SetMode, maxPick?: number | null): { min_select: number; max_select: number | null } {
  if (mode === "required_one") return { min_select: 1, max_select: 1 };
  if (mode === "optional_one") return { min_select: 0, max_select: 1 };
  return { min_select: 0, max_select: maxPick && maxPick >= 1 ? Math.trunc(maxPick) : null };
}

export function limitsToMode(min: number, max: number | null): { mode: SetMode; max_pick: number | null } {
  if (max === 1) return { mode: min >= 1 ? "required_one" : "optional_one", max_pick: null };
  return { mode: "multi", max_pick: max };
}

export type OptionSetInput = {
  name: string;
  mode: SetMode;
  max_pick?: number | null;
  options: Array<{ id?: string; name: string; price_delta: number }>;
  item_ids: string[];
  category_ids: string[];
};

/** 回傳給店員看的中文錯誤；沒問題回 null。 */
export function validateOptionSetInput(input: unknown): string | null {
  const v = input as Partial<OptionSetInput> | null;
  if (!v || typeof v !== "object") return "資料格式不正確";
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (name.length < 1 || name.length > 60) return "選項組名稱請填 1 到 60 個字";
  if (v.mode !== "required_one" && v.mode !== "optional_one" && v.mode !== "multi") return "請選擇必選、可不選或可多選";
  if (v.mode === "multi" && v.max_pick != null && (!Number.isInteger(v.max_pick) || v.max_pick < 1)) {
    return "最多可選幾項要填 1 以上的整數，或留空代表不限";
  }
  if (!Array.isArray(v.options) || v.options.length < 1) return "請至少加一個選項";
  if (v.options.length > 30) return "一個選項組最多 30 個選項";
  const seen = new Set<string>();
  for (const option of v.options) {
    const n = typeof option?.name === "string" ? option.name.trim() : "";
    if (n.length < 1 || n.length > 100) return "每個選項名稱請填 1 到 100 個字";
    if (seen.has(n)) return `選項「${n}」重複了`;
    seen.add(n);
    if (typeof option.price_delta !== "number" || !Number.isFinite(option.price_delta) || option.price_delta < -10000 || option.price_delta > 10000) {
      return `選項「${n}」的加價請填數字`;
    }
  }
  if (v.mode === "multi" && v.max_pick != null && v.max_pick > v.options.length) return "最多可選的數量不能比選項還多";
  if (!Array.isArray(v.item_ids) || !Array.isArray(v.category_ids)) return "套用範圍格式不正確";
  return null;
}

export type SetDefinition = {
  id: string;
  name: string;
  display_order: number;
  options: Array<{ id: string; name: string; price_delta: number; display_order: number }>;
  item_ids: string[];
  category_ids: string[];
};

export type ItemRef = { id: string; category_id: string | null };

export type SyncRow = {
  item_id: string;
  set_id: string;
  set_option_id: string;
  option_group: string;
  option_name: string;
  price_delta: number;
  display_order: number;
};

export type ExistingOptionRow = SyncRow & { id: string };

/** 每個餐點應有的選項列：直接套用 + 經由分類套用，每個選項組只算一次。 */
export function desiredRows(items: ItemRef[], sets: SetDefinition[]): SyncRow[] {
  const rows: SyncRow[] = [];
  for (const item of items) {
    for (const set of sets) {
      const attached = set.item_ids.includes(item.id) || (item.category_id != null && set.category_ids.includes(item.category_id));
      if (!attached) continue;
      for (const option of set.options) {
        rows.push({
          item_id: item.id,
          set_id: set.id,
          set_option_id: option.id,
          option_group: set.name,
          option_name: option.name,
          price_delta: Number(option.price_delta),
          display_order: set.display_order * 1000 + option.display_order,
        });
      }
    }
  }
  return rows;
}

export type SyncPlan = {
  insert: SyncRow[];
  update: Array<{ id: string; patch: Partial<SyncRow> }>;
  remove: string[];
};

/** existing 只放有 set_option_id 的列（沒有的舊特例列不歸選項組管）。 */
export function planOptionSync(existing: ExistingOptionRow[], desired: SyncRow[]): SyncPlan {
  const key = (r: { item_id: string; set_option_id: string }) => `${r.item_id}:${r.set_option_id}`;
  const have = new Map(existing.map((r) => [key(r), r]));
  const want = new Map(desired.map((r) => [key(r), r]));
  const plan: SyncPlan = { insert: [], update: [], remove: [] };
  for (const [k, row] of want) {
    const cur = have.get(k);
    if (!cur) {
      plan.insert.push(row);
      continue;
    }
    const patch: Partial<SyncRow> = {};
    if (cur.set_id !== row.set_id) patch.set_id = row.set_id;
    if (cur.option_group !== row.option_group) patch.option_group = row.option_group;
    if (cur.option_name !== row.option_name) patch.option_name = row.option_name;
    if (Number(cur.price_delta) !== row.price_delta) patch.price_delta = row.price_delta;
    if (cur.display_order !== row.display_order) patch.display_order = row.display_order;
    if (Object.keys(patch).length) plan.update.push({ id: cur.id, patch });
  }
  for (const [k, row] of have) if (!want.has(k)) plan.remove.push(row.id);
  return plan;
}

// ── 顧客端／伺服器共用的「選了什麼」檢查（和資料庫的 assert_menu_item_option_selection 同一套規則）──

/** menu_item_options 的列，加上嵌入的選項組（PostgREST: set:menu_option_sets(min_select,max_select)）。 */
export type RuleOption = {
  id: string;
  option_group: string;
  set_id?: string | null;
  set?: { min_select: number; max_select: number | null } | null;
};

export type OptionGroupRule = { key: string; label: string; min: number; max: number | null; optionIds: string[] };

/** 沒有選項組的舊特例列：同組名最多一項、可不選（和資料庫一致）。 */
export function optionGroupRules(options: RuleOption[]): OptionGroupRule[] {
  const groups = new Map<string, OptionGroupRule>();
  for (const o of options) {
    const key = o.set_id ?? `g:${o.option_group}`;
    const g = groups.get(key) ?? { key, label: o.option_group, min: o.set?.min_select ?? 0, max: o.set_id ? (o.set?.max_select ?? null) : 1, optionIds: [] };
    g.optionIds.push(o.id);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** 回傳中文錯誤；沒問題回 null。enforceMin=false 給「存草稿」用（還沒選完也能存）。 */
export function checkOptionSelection(options: RuleOption[], pickedIds: string[], enforceMin = true): string | null {
  const picked = new Set(pickedIds);
  if (picked.size !== pickedIds.length) return "餐點選項重複";
  const known = new Set(options.map((o) => o.id));
  if ([...picked].some((id) => !known.has(id))) return "餐點選項已變更，請重新選擇";
  for (const g of optionGroupRules(options)) {
    const n = g.optionIds.filter((id) => picked.has(id)).length;
    if (enforceMin && n < g.min) return `請選擇「${g.label}」`;
    if (g.max != null && n > g.max) return g.max === 1 ? `「${g.label}」只能選一項` : `「${g.label}」最多選 ${g.max} 項`;
  }
  return null;
}

/** 一整張清單（購物車／預點）有沒有哪個餐點還沒選完。 */
export function selectionProblem(
  items: Array<{ id: string; name: string; options?: RuleOption[] }>,
  rows: Array<{ menu_item_id: string; option_ids?: string[] }>,
  enforceMin = true,
): string | null {
  for (const row of rows) {
    const item = items.find((i) => i.id === row.menu_item_id);
    if (!item) continue;
    const problem = checkOptionSelection(item.options ?? [], row.option_ids ?? [], enforceMin);
    if (problem) return `${item.name}：${problem}`;
  }
  return null;
}
