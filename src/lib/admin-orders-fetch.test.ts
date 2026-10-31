import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllAdminOrders } from "./admin-orders-fetch";

afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
