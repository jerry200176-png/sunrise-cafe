import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncBranchOptions } from "./option-sets-db";

/** 極簡記憶體版 Supabase：只實作 syncBranchOptions 用到的鏈式查詢。 */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  const log: string[] = [];
  const from = (name: string) => {
    let rows = tables[name] ?? [];
    const q: Record<string, unknown> = {};
    const api = {
      select: () => api,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), api),
      in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), api),
      not: (c: string) => ((rows = rows.filter((r) => r[c] != null)), api),
      order: () => api,
      delete: () => ({ in: async (_c: string, ids: string[]) => { log.push(`delete ${ids.join(",")}`); tables[name] = tables[name].filter((r) => !ids.includes(r.id as string)); return { error: null }; } }),
      insert: async (v: Array<Record<string, unknown>>) => { log.push(`insert ${v.length}`); tables[name].push(...v.map((r, i) => ({ id: `new${i}`, ...r }))); return { error: null }; },
      update: (patch: Record<string, unknown>) => ({ eq: async (_c: string, id: string) => { log.push(`update ${id}`); Object.assign(tables[name].find((r) => r.id === id)!, patch); return { error: null }; } }),
      then: (res: (v: { data: unknown; error: null }) => void) => res({ data: rows, error: null }),
    };
    void q;
    return api;
  };
  return { db: { from } as unknown as SupabaseClient, log, tables };
}

describe("syncBranchOptions", () => {
  const base = () => ({
    menu_option_sets: [{ id: "s1", branch_id: "b", name: "甜度", min_select: 0, max_select: 1, display_order: 1, created_at: 1 }],
    menu_option_set_options: [
      { id: "o1", set_id: "s1", name: "全糖", price_delta: 0, display_order: 0 },
      { id: "o2", set_id: "s1", name: "半糖", price_delta: 0, display_order: 1 },
    ],
    menu_option_set_items: [{ set_id: "s1", item_id: "a" }],
    menu_option_set_categories: [{ set_id: "s1", category_id: "drinks" }],
    menu_items: [
      { id: "a", branch_id: "b", category_id: null },
      { id: "b2", branch_id: "b", category_id: "drinks" },
      { id: "c", branch_id: "b", category_id: "food" },
    ],
    menu_item_options: [] as Array<Record<string, unknown>>,
  });

  it("creates rows for direct + category attachments, then is idempotent", async () => {
    const { db, tables } = fakeDb(base());
    const first = await syncBranchOptions(db, "b");
    expect(first).toEqual({ inserted: 4, updated: 0, removed: 0 });
    expect(new Set(tables.menu_item_options.map((r) => r.item_id))).toEqual(new Set(["a", "b2"]));
    expect(await syncBranchOptions(db, "b")).toEqual({ inserted: 0, updated: 0, removed: 0 });
  });

  it("detaching removes only generated rows and keeps legacy rows without set_option_id", async () => {
    const t = base();
    t.menu_item_options = [
      { id: "g1", item_id: "c", set_id: "gone", set_option_id: "ox", option_group: "舊", option_name: "x", price_delta: 0, display_order: 0 },
      { id: "legacy", item_id: "c", set_id: null, set_option_id: null, option_group: "冰塊", option_name: "少冰", price_delta: 0, display_order: 0 },
    ];
    const { db, tables } = fakeDb(t);
    const result = await syncBranchOptions(db, "b");
    expect(result.removed).toBe(1);
    expect(tables.menu_item_options.some((r) => r.id === "legacy")).toBe(true);
    expect(tables.menu_item_options.some((r) => r.id === "g1")).toBe(false);
  });
});
