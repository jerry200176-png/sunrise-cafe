import { createHash } from "node:crypto";

/**
 * 預覽「既有每個餐點各自的選項」會被合併成哪些選項組。
 * 規則和 supabase/migration-menu-option-sets.sql 的 DO 區塊完全一致：
 *   同分店 + 同組名 + 選項名稱與加價完全相同 → 同一個選項組；
 *   同組名但內容不同 → 另建「組名 (2)」…（內容相同餐點數最多的叫原名）；
 *   同一餐點同組內選項名稱重複 → 不合併（保留原樣）。
 */
export type LegacyOptionRow = {
  item_id: string;
  item_name: string;
  branch_id: string;
  option_group: string;
  option_name: string;
  price_delta: number;
  display_order: number;
};

export type PlannedSet = {
  branch_id: string;
  name: string;
  group: string;
  options: Array<{ name: string; price_delta: number }>;
  items: Array<{ id: string; name: string }>;
};

export type MergePlan = {
  sets: PlannedSet[];
  unmerged: Array<{ item_id: string; item_name: string; group: string; reason: string }>;
  legacy_group_count: number;
};

export function planOptionSetMerge(rows: LegacyOptionRow[]): MergePlan {
  const byItemGroup = new Map<string, LegacyOptionRow[]>();
  for (const row of rows) {
    const key = `${row.item_id}\u0000${row.option_group}`;
    byItemGroup.set(key, [...(byItemGroup.get(key) ?? []), row]);
  }

  const unmerged: MergePlan["unmerged"] = [];
  const buckets = new Map<string, { sig: string; items: Array<{ id: string; name: string }>; sample: LegacyOptionRow[] }>();
  for (const group of byItemGroup.values()) {
    const first = group[0];
    const names = group.map((g) => g.option_name);
    if (new Set(names).size !== names.length) {
      unmerged.push({ item_id: first.item_id, item_name: first.item_name, group: first.option_group, reason: "同一組內有重複的選項名稱" });
      continue;
    }
    const sorted = [...group].sort((a, b) => a.option_name.localeCompare(b.option_name) || a.price_delta - b.price_delta);
    const sig = createHash("md5").update(sorted.map((g) => `${g.option_name}\u0001${g.price_delta}`).join("\u0002")).digest("hex");
    const key = `${first.branch_id}\u0000${first.option_group}\u0000${sig}`;
    const bucket = buckets.get(key) ?? { sig, items: [], sample: [...group].sort((a, b) => a.display_order - b.display_order) };
    bucket.items.push({ id: first.item_id, name: first.item_name });
    buckets.set(key, bucket);
  }

  const perGroup = new Map<string, Array<{ branch_id: string; group: string; sig: string; items: Array<{ id: string; name: string }>; sample: LegacyOptionRow[] }>>();
  for (const [key, b] of buckets) {
    const [branch_id, group] = key.split("\u0000");
    const gk = `${branch_id}\u0000${group}`;
    perGroup.set(gk, [...(perGroup.get(gk) ?? []), { branch_id, group, sig: b.sig, items: b.items, sample: b.sample }]);
  }

  const sets: PlannedSet[] = [];
  for (const list of [...perGroup.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)) {
    list.sort((a, b) => b.items.length - a.items.length || a.sig.localeCompare(b.sig));
    list.forEach((entry, index) => {
      sets.push({
        branch_id: entry.branch_id,
        group: entry.group,
        name: (index === 0 ? entry.group : `${entry.group} (${index + 1})`).slice(0, 60),
        options: entry.sample.map((o) => ({ name: o.option_name, price_delta: Number(o.price_delta) })),
        items: entry.items.sort((a, b) => a.name.localeCompare(b.name)),
      });
    });
  }
  return { sets, unmerged, legacy_group_count: byItemGroup.size };
}

/** 給人看的預覽文字。 */
export function formatMergePlan(plan: MergePlan, branchNames: Record<string, string> = {}): string {
  const lines: string[] = [];
  const attached = plan.sets.reduce((n, s) => n + s.items.length, 0);
  lines.push(`既有「餐點各自的選項組」${plan.legacy_group_count} 筆 → 合併成 ${plan.sets.length} 個選項組（共套用到 ${attached} 個餐點）`);
  lines.push("行為不變：全部都是「可不選、最多選一個」，加價與選項名稱都不變。");
  let current = "";
  for (const set of plan.sets) {
    if (set.branch_id !== current) {
      current = set.branch_id;
      lines.push("", `【${branchNames[set.branch_id] ?? set.branch_id}】`);
    }
    const choices = set.options.map((o) => `${o.name}${o.price_delta ? `(${o.price_delta > 0 ? "+" : ""}${o.price_delta})` : ""}`).join("、");
    lines.push(`  ${set.name}：${choices}`, `    套用到 ${set.items.length} 個餐點：${set.items.map((i) => i.name).join("、")}`);
  }
  if (plan.unmerged.length) {
    lines.push("", "不會合併（保留原樣，仍可正常點餐）：");
    for (const u of plan.unmerged) lines.push(`  ${u.item_name} / ${u.group}：${u.reason}`);
  }
  return lines.join("\n");
}
