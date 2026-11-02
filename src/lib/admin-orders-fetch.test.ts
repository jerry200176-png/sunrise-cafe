import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllAdminOrders } from "./admin-orders-fetch";

afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const order = (id: string) => ({ id, branch_id: "b1", status: "pending", is_printed: false, notes: null,
  created_at: "2026-10-31T10:00:00Z", total_amount: 100, table: null, order_items: [] });

describe("fetchAllAdminOrders", () => {
  it("returns all pages only after the last page", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ items: [{ id: "a" }], nextCursor: "next" }))
      .mockResolvedValueOnce(response({ items: [{ id: "b" }], nextCursor: null }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchAllAdminOrders("b1")).toEqual([{ id: "a" }, { id: "b" }]);
    expect(String(fetch.mock.calls[1][0])).toContain("cursor=next");
  });
  it("keeps the same eight-hour printable cutoff across pages", async () => {
    const now = Date.now();
    const fetch = vi.fn().mockResolvedValueOnce(response({ items: [{ id: "a" }], nextCursor: "next" }))
      .mockResolvedValueOnce(response({ items: [{ id: "b" }], nextCursor: null }));
    vi.stubGlobal("fetch", fetch);
    await fetchAllAdminOrders("b1", () => true, "printable");
    const first = new URL(String(fetch.mock.calls[0][0]), "http://localhost");
    const second = new URL(String(fetch.mock.calls[1][0]), "http://localhost");
    expect(first.searchParams.get("scope")).toBe("printable");
    expect(first.searchParams.get("since")).toBe(second.searchParams.get("since"));
    expect(Math.abs(Date.parse(first.searchParams.get("since")!) - (now - 8 * 60 * 60 * 1000))).toBeLessThan(1000);
  });
  it("opts into v2 on every page while the legacy helper remains unchanged", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ items: [order("a")], nextCursor: "next" }))
      .mockResolvedValueOnce(response({ items: [order("b")], nextCursor: null }))
      .mockResolvedValueOnce(response({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetch);
    await fetchAllAdminOrders("b1", () => true, "printable", "v2");
    await fetchAllAdminOrders("b1");
    const params = fetch.mock.calls.map(([url]) => new URL(String(url), "http://localhost").searchParams);
    expect(params[0].get("listContract")).toBe("v2");
    expect(params[1].get("listContract")).toBe("v2");
    expect(params[2].has("listContract")).toBe(false);
  });
  it("projects and validates old-server responses for v2 while preserving the legacy helper", async () => {
    const oldServerRow = { ...order("a"), internal: "secret", order_items: [{ id: "i", item_name: "麵", quantity: 1, selected_options: null, special_notes: 0 }] };
    const fetch = vi.fn().mockResolvedValueOnce(response({ items: [oldServerRow], nextCursor: null }))
      .mockResolvedValueOnce(response({ items: [oldServerRow], nextCursor: null }))
      .mockResolvedValueOnce(response({ items: [{ ...order("b"), internal: "secret" }], nextCursor: null }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchAllAdminOrders("b1", () => true, "printable", "v2")).rejects.toThrow("訂單資料格式不正確");
    expect(await fetchAllAdminOrders("b1")).toEqual([oldServerRow]);
    expect(await fetchAllAdminOrders("b1", () => true, "active", "v2")).toEqual([order("b")]);
  });
  it("rejects a failed later page instead of returning partial orders", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ items: [{ id: "a" }], nextCursor: "next" }))
      .mockResolvedValueOnce(response({ error: "failed" }, 503)));
    await expect(fetchAllAdminOrders("b1")).rejects.toThrow();
  });
  it("rejects a repeated cursor and a stale branch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response({ items: [], nextCursor: "same" })));
    await expect(fetchAllAdminOrders("b1")).rejects.toThrow("分頁重複");
    await expect(fetchAllAdminOrders("b1", () => false)).rejects.toThrow("分店已變更");
  });
  it("rejects malformed completion markers and duplicate rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ items: [], nextCursor: "" })));
    await expect(fetchAllAdminOrders("b1")).rejects.toThrow("格式不正確");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ items: [{ id: "a" }], nextCursor: "next" }))
      .mockResolvedValueOnce(response({ items: [{ id: "a" }], nextCursor: null })));
    await expect(fetchAllAdminOrders("b1")).rejects.toThrow("資料不一致");
  });
});
