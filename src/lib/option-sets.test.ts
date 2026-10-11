import { describe, expect, it } from "vitest";
import {
  desiredRows,
  limitsToMode,
  modeToLimits,
  planOptionSync,
  validateOptionSetInput,
  type ExistingOptionRow,
  type SetDefinition,
} from "./option-sets";

const sugar: SetDefinition = {
  id: "s1", name: "甜度", display_order: 1,
  options: [
    { id: "o1", name: "全糖", price_delta: 0, display_order: 0 },
    { id: "o2", name: "半糖", price_delta: 0, display_order: 1 },
  ],
  item_ids: ["a"], category_ids: ["drinks"],
};

describe("modes", () => {
  it("round-trips the three modes", () => {
    expect(modeToLimits("required_one")).toEqual({ min_select: 1, max_select: 1 });
    expect(modeToLimits("optional_one")).toEqual({ min_select: 0, max_select: 1 });
    expect(modeToLimits("multi", 3)).toEqual({ min_select: 0, max_select: 3 });
    expect(modeToLimits("multi")).toEqual({ min_select: 0, max_select: null });
    expect(limitsToMode(1, 1).mode).toBe("required_one");
    expect(limitsToMode(0, 1).mode).toBe("optional_one");
    expect(limitsToMode(0, 4)).toEqual({ mode: "multi", max_pick: 4 });
  });
});

describe("validateOptionSetInput", () => {
  const ok = { name: "甜度", mode: "required_one", options: [{ name: "全糖", price_delta: 0 }], item_ids: [], category_ids: [] };
  it("accepts a good set", () => expect(validateOptionSetInput(ok)).toBeNull());
  it.each([
    [{ ...ok, name: " " }, "名稱"],
    [{ ...ok, mode: "x" }, "必選"],
    [{ ...ok, options: [] }, "至少"],
    [{ ...ok, options: [{ name: "a", price_delta: 0 }, { name: "a", price_delta: 5 }] }, "重複"],
    [{ ...ok, options: [{ name: "a", price_delta: Number.NaN }] }, "加價"],
    [{ ...ok, mode: "multi", max_pick: 3 }, "不能比選項還多"],
    [{ ...ok, mode: "multi", max_pick: 0 }, "整數"],
  ])("rejects %#", (input, fragment) => expect(validateOptionSetInput(input)).toContain(fragment));
});

describe("desiredRows", () => {
  it("attaches by item and by category, once per set", () => {
    const rows = desiredRows(
      [{ id: "a", category_id: "drinks" }, { id: "b", category_id: "drinks" }, { id: "c", category_id: "food" }],
      [sugar]
    );
    expect(rows.map((r) => `${r.item_id}:${r.option_name}`)).toEqual(["a:全糖", "a:半糖", "b:全糖", "b:半糖"]);
    expect(rows[0].option_group).toBe("甜度");
  });
});

describe("planOptionSync", () => {
  const existing = (over: Partial<ExistingOptionRow>): ExistingOptionRow => ({
    id: "row1", item_id: "a", set_id: "s1", set_option_id: "o1", option_group: "甜度", option_name: "全糖", price_delta: 0, display_order: 1000, ...over,
  });
  const desired = desiredRows([{ id: "a", category_id: null }], [sugar]);

  it("no change → empty plan (ids stay stable)", () => {
    const plan = planOptionSync([existing({}), existing({ id: "row2", set_option_id: "o2", option_name: "半糖", display_order: 1001 })], desired);
    expect(plan).toEqual({ insert: [], update: [], remove: [] });
  });
  it("rename / price change updates in place instead of recreating", () => {
    const plan = planOptionSync(
      [existing({ option_name: "全糖(舊)", price_delta: 5 }), existing({ id: "row2", set_option_id: "o2", option_name: "半糖", display_order: 1001 })],
      desired
    );
    expect(plan.update).toEqual([{ id: "row1", patch: { option_name: "全糖", price_delta: 0 } }]);
    expect(plan.insert).toEqual([]);
  });
  it("detach removes rows, new choice inserts a row", () => {
    expect(planOptionSync([existing({}), existing({ id: "gone", set_option_id: "oX" })], desired.slice(0, 1)).remove).toEqual(["gone"]);
    expect(planOptionSync([existing({})], desired).insert.map((r) => r.option_name)).toEqual(["半糖"]);
  });
});
