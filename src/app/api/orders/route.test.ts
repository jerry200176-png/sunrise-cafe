import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  table: null as Row | null,
  catalog: [] as Row[],
  catalogFilters: [] as Array<[string, unknown]>,
  orderInserts: [] as Row[],
  itemInserts: [] as Row[][],
  rpcCalls: [] as Row[],
  rpcError: null as { message: string; code?: string } | null,
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
        if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
          resolve({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
          return;
        }
        resolve({ data: state.catalog.filter((row) => ids.includes(row.id as string)), error: null });
        return;
      }
      resolve({ data: null, error: null });
    },
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (name: string) => builder(name), rpc: async (_name: string, args: Row) => {
  state.rpcCalls.push(args); return state.rpcError ? { data: null, error: state.rpcError } : { data: "order-1", error: null };
} }) }));

import { POST } from "./route";

const LATTE = "11111111-1111-4111-8111-111111111111";
const CAKE = "22222222-2222-4222-8222-222222222222";
const SOLDOUT = "33333333-3333-4333-8333-333333333333";
const GHOST = "44444444-4444-4444-8444-444444444444";
const OTHER_BRANCH = "55555555-5555-4555-8555-555555555555";


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
    menuItem: { id: LATTE, name: "拿鐵", price: 120 },
    quantity: 2,
    selectedOptions: [{ group: "尺寸", name: "大", delta: 20 }],
    specialNotes: "少冰",
    ...overrides,
  };
}

describe("POST /api/orders server-side pricing (#434)", () => {
  beforeEach(() => {
    state.table = { id: "table-1", branch_id: "branch-1", is_active: true, branches: { archived_at: null } };
    state.catalog = [
      { id: LATTE, name: "拿鐵", price: 120, is_available: true, options: sizeOptions },
      { id: CAKE, name: "蛋糕", price: "90", is_available: true, options: [] },
      { id: SOLDOUT, name: "售完", price: 50, is_available: false, options: [] },
    ];
    state.catalogFilters = [];
    state.orderInserts = [];
    state.itemInserts = [];
    state.rpcCalls = [];
    state.rpcError = null;
  });

  it("prices from the menu and keeps the response shape", async () => {
    const res = await post({ tableToken: "qr-1", items: [cartLine(), cartLine({ menuItem: { id: CAKE, price: 90 }, quantity: 1, selectedOptions: [] })] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orderId: "order-1" });
    expect(state.rpcCalls[0]).toMatchObject({ p_branch_id: "branch-1", p_table_id: "table-1", p_table_token: "qr-1" });
    expect(state.rpcCalls[0].p_items).toEqual([
      expect.objectContaining({ menu_item_id: LATTE, item_name: "拿鐵", quantity: 2, unit_price: 140, selected_options: [{ group: "尺寸", name: "大", delta: 20 }], special_notes: "少冰" }),
      expect.objectContaining({ menu_item_id: CAKE, unit_price: 90, selected_options: null }),
    ]);
    // 只查這張桌子所屬分店的菜單
    expect(state.catalogFilters).toContainEqual(["branch_id", "branch-1"]);
  });

  it("rejects changed customer-visible prices without inserting", async () => {
    const res = await post({
      tableToken: "qr-1",
      items: [cartLine({ menuItem: { id: LATTE, name: "免費咖啡", price: 1 }, selectedOptions: [{ group: "尺寸", name: "大", delta: -500 }] })],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/價格已變更/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it.each([
    cartLine({ menuItem: { id: LATTE, price: 100 } }),
    cartLine({ selectedOptions: [{ group: "尺寸", name: "大", delta: 5 }] }),
  ])("requires a fresh selection when displayed base price or option surcharge changes", async (item) => {
    const res = await post({ tableToken: "qr-1", items: [item] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/刪除購物車中的舊餐點/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it.each([
    ["qr_catalog_changed", 409], ["qr_branch_unavailable", 403], ["function unavailable", 503],
  ])("fails closed when the atomic write reports %s", async (message, status) => {
    state.rpcError = { message, code: "P0001" };
    const res = await post({ tableToken: "qr-1", items: [cartLine()] });
    expect(res.status).toBe(status);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.orderInserts).toHaveLength(0);
    expect(state.itemInserts).toHaveLength(0);
  });
  it("does not call an ambiguous RPC error safe to retry based on message alone", async () => {
    state.rpcError = { message: "qr_catalog_changed" };
    const res = await post({ tableToken: "qr-1", items: [cartLine()] });
    expect(res.status).toBe(503);
    expect((await res.json()).safe_to_retry).not.toBe(true);
  });

  it("rejects ambiguous option labels instead of charging the price of an arbitrary match", async () => {
    state.catalog[0].options = [...sizeOptions, { ...sizeOptions[1], id: "other-opt", set_id: "other-set", price_delta: 50 }];
    const res = await post({ tableToken: "qr-1", items: [cartLine()] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/名稱重複/);
    expect(state.orderInserts).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it.each([
    ["unknown item", [cartLine({ menuItem: { id: GHOST, price: 1 } })], /無法點餐/],
    ["unavailable item", [cartLine({ menuItem: { id: SOLDOUT, price: 50 }, selectedOptions: [] })], /無法點餐/],
    ["item from another branch (filtered out of catalog)", [cartLine({ menuItem: { id: OTHER_BRANCH } })], /無法點餐/],
    ["zero quantity", [cartLine({ quantity: 0 })], /數量/],
    ["negative quantity", [cartLine({ quantity: -3 })], /數量/],
    ["fractional quantity", [cartLine({ quantity: 1.5 })], /數量/],
    ["huge quantity", [cartLine({ quantity: 100000 })], /數量/],
    ["string quantity", [cartLine({ quantity: "2" })], /數量/],
    ["unknown option", [cartLine({ selectedOptions: [{ group: "尺寸", name: "特大", delta: 0 }] })], /選項已變更/],
    ["missing required option", [cartLine({ selectedOptions: [] })], /請選擇/],
    ["missing menuItem id", [{ quantity: 1, selectedOptions: [] }], /格式不正確/],
    ["non-UUID item id (would be Postgres 22P02 / 500)", [cartLine({ menuItem: { id: "latte" } })], /無法點餐/],
    ["non-UUID item id with SQL-ish text", [cartLine({ menuItem: { id: "x') or 1=1--" } })], /無法點餐/],
    ["duplicated option", [cartLine({ selectedOptions: [{ group: "尺寸", name: "大", delta: 20 }, { group: "尺寸", name: "大", delta: 20 }] })], /重複/],
    ["option belonging to another item", [cartLine({ menuItem: { id: CAKE }, selectedOptions: [{ group: "尺寸", name: "大", delta: 20 }] })], /選項已變更/],
  ])("rejects %s with 400 and writes nothing", async (_label, items, message) => {
    const res = await post({ tableToken: "qr-1", items });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(state.orderInserts).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.itemInserts).toHaveLength(0);
  });

  it("ignores injected total, discount and unit_price fields", async () => {
    const res = await post({
      tableToken: "qr-1",
      total_amount: 1,
      total: 1,
      discount: 999,
      items: [{ ...cartLine(), unit_price: 1, total_amount: 1, discount: 999, item_name: "免費" }],
    });
    expect(res.status).toBe(200);
    expect(state.rpcCalls[0]).not.toHaveProperty("discount");
    const item = (state.rpcCalls[0].p_items as Row[])[0];
    expect(item).toMatchObject({ item_name: "拿鐵", unit_price: 140 });
    expect(item).not.toHaveProperty("discount");
    expect(item).not.toHaveProperty("total_amount");
  });

  it("rejects too many lines, an empty cart, and malformed JSON", async () => {
    expect((await post({ tableToken: "qr-1", items: Array.from({ length: 51 }, () => cartLine()) })).status).toBe(400);
    expect((await post({ tableToken: "qr-1", items: [] })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    expect(state.orderInserts).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("keeps table checks: unknown 404, inactive 403", async () => {
    state.table = null;
    expect((await post({ tableToken: "nope", items: [cartLine()] })).status).toBe(404);
    state.table = { id: "table-1", branch_id: "branch-1", is_active: false };
    expect((await post({ tableToken: "qr-1", items: [cartLine()] })).status).toBe(403);
    expect(state.orderInserts).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("fails closed for archived or unverified branches before writing", async () => {
    state.table!.branches = { archived_at: "2026-10-01T00:00:00Z" };
    expect((await post({ tableToken: "qr-1", items: [cartLine()] })).status).toBe(403);
    state.table!.branches = {};
    expect((await post({ tableToken: "qr-1", items: [cartLine()] })).status).toBe(503);
    state.table!.branches = null;
    expect((await post({ tableToken: "qr-1", items: [cartLine()] })).status).toBe(503);
    expect(state.orderInserts).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
  });
});
