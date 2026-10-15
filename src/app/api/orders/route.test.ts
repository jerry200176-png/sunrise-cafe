import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  table: null as Row | null,
  catalog: [] as Row[],
  catalogFilters: [] as Array<[string, unknown]>,
  orderInserts: [] as Row[],
  itemInserts: [] as Row[][],
}));

function builder(tableName: string) {
  const filters: Array<[string, unknown]> = [];
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    in: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    single: async () => {
      if (tableName === "tables") {
        return state.table ? { data: state.table, error: null } : { data: null, error: { message: "not found" } };
      }
      if (tableName === "orders") return { data: { id: "order-1" }, error: null };
      return { data: null, error: { message: "unexpected" } };
    },
    insert: (payload: Row | Row[]) => {
      if (tableName === "orders") state.orderInserts.push(payload as Row);
      if (tableName === "order_items") {
        state.itemInserts.push(payload as Row[]);
        return Promise.resolve({ error: null });
      }
      return chain;
    },
    then: (resolve: (value: unknown) => void) => {
      if (tableName === "menu_items") {
        state.catalogFilters = filters;
        const ids = (filters.find(([column]) => column === "id")?.[1] ?? []) as string[];
        resolve({ data: state.catalog.filter((row) => ids.includes(row.id as string)), error: null });
        return;
      }
      resolve({ data: null, error: null });
    },
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (name: string) => builder(name) }) }));

import { POST } from "./route";

const sizeOptions = [
  { id: "opt-s", option_group: "尺寸", option_name: "小", price_delta: 0, set_id: "set-size", set: { min_select: 1, max_select: 1 } },
  { id: "opt-l", option_group: "尺寸", option_name: "大", price_delta: 20, set_id: "set-size", set: { min_select: 1, max_select: 1 } },
];

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function cartLine(overrides: Row = {}) {
  return {
    menuItem: { id: "latte", name: "拿鐵", price: 120 },
    quantity: 2,
    selectedOptions: [{ group: "尺寸", name: "大", delta: 20 }],
    specialNotes: "少冰",
    ...overrides,
  };
}

describe("POST /api/orders server-side pricing (#434)", () => {
  beforeEach(() => {
    state.table = { id: "table-1", branch_id: "branch-1", is_active: true };
    state.catalog = [
      { id: "latte", name: "拿鐵", price: 120, is_available: true, options: sizeOptions },
      { id: "cake", name: "蛋糕", price: "90", is_available: true, options: [] },
      { id: "soldout", name: "售完", price: 50, is_available: false, options: [] },
    ];
    state.catalogFilters = [];
    state.orderInserts = [];
    state.itemInserts = [];
  });

  it("prices from the menu and keeps the response shape", async () => {
    const res = await post({ tableToken: "qr-1", items: [cartLine(), cartLine({ menuItem: { id: "cake" }, quantity: 1, selectedOptions: [] })] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orderId: "order-1" });
    expect(state.orderInserts[0]).toMatchObject({ branch_id: "branch-1", table_id: "table-1", status: "pending", total_amount: 2 * 140 + 90 });
    expect(state.itemInserts[0]).toEqual([
      expect.objectContaining({ order_id: "order-1", menu_item_id: "latte", item_name: "拿鐵", quantity: 2, unit_price: 140, selected_options: [{ group: "尺寸", name: "大", delta: 20 }], special_notes: "少冰" }),
      expect.objectContaining({ menu_item_id: "cake", unit_price: 90, selected_options: null }),
    ]);
    // 只查這張桌子所屬分店的菜單
    expect(state.catalogFilters).toContainEqual(["branch_id", "branch-1"]);
  });

  it("ignores a tampered client price, name, and option delta", async () => {
    const res = await post({
      tableToken: "qr-1",
      items: [cartLine({ menuItem: { id: "latte", name: "免費咖啡", price: 1 }, selectedOptions: [{ group: "尺寸", name: "大", delta: -500 }] })],
    });
    expect(res.status).toBe(200);
    expect(state.orderInserts[0].total_amount).toBe(280);
    expect(state.itemInserts[0][0]).toMatchObject({ item_name: "拿鐵", unit_price: 140, selected_options: [{ group: "尺寸", name: "大", delta: 20 }] });
  });

  it.each([
    ["unknown item", [cartLine({ menuItem: { id: "ghost", price: 1 } })], /無法點餐/],
    ["unavailable item", [cartLine({ menuItem: { id: "soldout", price: 50 }, selectedOptions: [] })], /無法點餐/],
    ["item from another branch (filtered out of catalog)", [cartLine({ menuItem: { id: "other-branch-item" } })], /無法點餐/],
    ["zero quantity", [cartLine({ quantity: 0 })], /數量/],
    ["negative quantity", [cartLine({ quantity: -3 })], /數量/],
    ["fractional quantity", [cartLine({ quantity: 1.5 })], /數量/],
    ["huge quantity", [cartLine({ quantity: 100000 })], /數量/],
    ["string quantity", [cartLine({ quantity: "2" })], /數量/],
    ["unknown option", [cartLine({ selectedOptions: [{ group: "尺寸", name: "特大", delta: 0 }] })], /選項已變更/],
    ["missing required option", [cartLine({ selectedOptions: [] })], /請選擇/],
    ["missing menuItem id", [{ quantity: 1, selectedOptions: [] }], /格式不正確/],
  ])("rejects %s with 400 and writes nothing", async (_label, items, message) => {
    const res = await post({ tableToken: "qr-1", items });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(state.orderInserts).toHaveLength(0);
    expect(state.itemInserts).toHaveLength(0);
  });

  it("rejects too many lines, an empty cart, and malformed JSON", async () => {
    expect((await post({ tableToken: "qr-1", items: Array.from({ length: 51 }, () => cartLine()) })).status).toBe(400);
    expect((await post({ tableToken: "qr-1", items: [] })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    expect(state.orderInserts).toHaveLength(0);
  });

  it("keeps table checks: unknown 404, inactive 403", async () => {
    state.table = null;
    expect((await post({ tableToken: "nope", items: [cartLine()] })).status).toBe(404);
    state.table = { id: "table-1", branch_id: "branch-1", is_active: false };
    expect((await post({ tableToken: "qr-1", items: [cartLine()] })).status).toBe(403);
    expect(state.orderInserts).toHaveLength(0);
  });
});
