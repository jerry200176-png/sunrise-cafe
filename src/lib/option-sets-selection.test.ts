import { describe, expect, it } from "vitest";
import { checkOptionSelection, selectionProblem, type RuleOption } from "@/lib/option-sets";

const req = { min_select: 1, max_select: 1 };
const multi = { min_select: 0, max_select: 2 };
const opts: RuleOption[] = [
  { id: "a1", option_group: "甜度", set_id: "s1", set: req },
  { id: "a2", option_group: "甜度", set_id: "s1", set: req },
  { id: "b1", option_group: "加料", set_id: "s2", set: multi },
  { id: "b2", option_group: "加料", set_id: "s2", set: multi },
  { id: "b3", option_group: "加料", set_id: "s2", set: multi },
  { id: "l1", option_group: "冰量", set_id: null },
  { id: "l2", option_group: "冰量", set_id: null },
];

describe("checkOptionSelection", () => {
  it.each([
    ["required missing", [], "請選擇「甜度」"],
    ["required ok", ["a1"], null],
    ["required_one picked twice", ["a1", "a2"], "「甜度」只能選一項"],
    ["multi within cap", ["a1", "b1", "b2"], null],
    ["multi over cap", ["a1", "b1", "b2", "b3"], "「加料」最多選 2 項"],
    ["legacy group max one", ["a1", "l1", "l2"], "「冰量」只能選一項"],
    ["legacy optional skipped", ["a2"], null],
    ["unknown option", ["a1", "zzz"], "餐點選項已變更，請重新選擇"],
    ["duplicate id", ["a1", "a1"], "餐點選項重複"],
  ])("%s", (_n, picked, expected) => {
    expect(checkOptionSelection(opts, picked)).toBe(expected);
  });

  it("draft mode skips the required check but keeps the cap", () => {
    expect(checkOptionSelection(opts, [], false)).toBeNull();
    expect(checkOptionSelection(opts, ["a1", "a2"], false)).toBe("「甜度」只能選一項");
  });

  it("selectionProblem names the offending item", () => {
    expect(selectionProblem([{ id: "i1", name: "拿鐵", options: opts }], [{ menu_item_id: "i1", option_ids: [] }])).toBe("拿鐵：請選擇「甜度」");
    expect(selectionProblem([{ id: "i1", name: "拿鐵", options: opts }], [{ menu_item_id: "i1", option_ids: ["a1"] }])).toBeNull();
  });
});
