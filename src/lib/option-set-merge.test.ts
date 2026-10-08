import { describe, expect, it } from "vitest";
import { formatMergePlan, planOptionSetMerge, type LegacyOptionRow } from "./option-set-merge";

const row = (item: string, name: string, group: string, option: string, delta = 0, order = 0, branch = "A"): LegacyOptionRow => ({
  item_id: item, item_name: name, branch_id: branch, option_group: group, option_name: option, price_delta: delta, display_order: order,
});

const rows: LegacyOptionRow[] = [
  row("1", "拿鐵", "甜度", "全糖", 0, 0), row("1", "拿鐵", "甜度", "半糖", 0, 1),
  row("2", "摩卡", "甜度", "半糖", 0, 0), row("2", "摩卡", "甜度", "全糖", 0, 1), // 順序不同、內容相同 → 同一組
  row("3", "紅茶", "甜度", "全糖", 0, 0), // 內容不同 → 甜度 (2)
  row("1", "拿鐵", "加料", "珍珠", 10), row("2", "摩卡", "加料", "珍珠", 20), // 加價不同 → 兩組
  row("9", "同德拿鐵", "甜度", "全糖", 0, 0, "B"), row("9", "同德拿鐵", "甜度", "半糖", 0, 1, "B"), // 不同分店不合併
  row("4", "怪品", "冰塊", "少冰"), row("4", "怪品", "冰塊", "少冰"),
];

describe("planOptionSetMerge", () => {
  const plan = planOptionSetMerge(rows);
  it("merges identical group+names+prices across items, keeps different ones apart", () => {
    const a = plan.sets.filter((s) => s.branch_id === "A");
    const sugar = a.find((s) => s.name === "甜度")!;
    expect(sugar.items.map((i) => i.name)).toEqual(["拿鐵", "摩卡"]);
    expect(sugar.options.map((o) => o.name)).toEqual(["全糖", "半糖"]);
    expect(a.find((s) => s.name === "甜度 (2)")!.items.map((i) => i.name)).toEqual(["紅茶"]);
    expect(a.filter((s) => s.group === "加料")).toHaveLength(2);
    expect(plan.sets.filter((s) => s.branch_id === "B")).toHaveLength(1);
  });
  it("leaves items with duplicate option names unmerged", () => {
    expect(plan.unmerged).toEqual([{ item_id: "4", item_name: "怪品", group: "冰塊", reason: "同一組內有重複的選項名稱" }]);
  });
  it("prints a readable preview", () => {
    const text = formatMergePlan(plan, { A: "大安店", B: "同德店" });
    expect(text).toContain("【大安店】");
    expect(text).toContain("甜度：全糖、半糖");
    expect(text).toContain("套用到 2 個餐點：拿鐵、摩卡");
    expect(text).toContain("可不選、最多選一個");
  });
});
