// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realtime = vi.hoisted(() => ({ callbacks: new Map<string, () => void>() }));
vi.mock("@/lib/use-admin-branches", () => ({ useAdminBranches: () => ({ branches: [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }], loading: false, error: null, retry: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  channel: (name: string) => {
    const channel = { on: (_event: string, _filter: unknown, callback: () => void) => { realtime.callbacks.set(name, callback); return channel; }, subscribe: () => channel };
    return channel;
  },
  removeChannel: vi.fn(),
} }));
import AdminOrdersPage from "./page";

const order = (id: string, name: string) => ({ id, status: "pending", created_at: "2026-10-31T10:00:00.000Z", total_amount: 100, table: { number: id }, order_items: [{ id: `item-${id}`, item_name: name, quantity: 1, unit_price: 100 }] });
const page = (items: unknown[], nextCursor: string | null) => ({ ok: true, status: 200, json: async () => ({ items, nextCursor }) }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("order board refresh scheduling", () => {
  let interval: (() => void) | undefined;
  beforeEach(() => {
    realtime.callbacks.clear();
    interval = undefined;
    const realInterval = window.setInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation(((callback: () => void, ms?: number) => {
      if (ms === 15000) interval = callback;
      return realInterval(callback, ms);
    }) as typeof window.setInterval);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("lets a slow multi-page scan finish and coalesces timer and Realtime refreshes", async () => {
    const secondPage = deferred<Response>();
    const refresh = deferred<Response>();
    const fetch = vi.fn().mockResolvedValueOnce(page([order("a", "第一頁餐點")], "next"))
      .mockReturnValueOnce(secondPage.promise).mockReturnValueOnce(refresh.promise);
    vi.stubGlobal("fetch", fetch);
    render(<AdminOrdersPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(interval).toBeDefined();
    expect(realtime.callbacks.has("orders-b1")).toBe(true);
    act(() => { interval?.(); interval?.(); realtime.callbacks.get("orders-b1")?.(); realtime.callbacks.get("orders-b1")?.(); });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => { secondPage.resolve(page([order("b", "第二頁餐點")], null)); });
    await screen.findByText("第一頁餐點");
    expect(screen.getByText("第二頁餐點")).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await act(async () => { refresh.resolve(page([order("c", "刷新後餐點")], null)); });
    await screen.findByText("刷新後餐點");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("starts a new branch immediately and never applies the old branch's delayed page", async () => {
    const oldPage = deferred<Response>();
    const fetch = vi.fn().mockResolvedValueOnce(page([order("a", "舊店第一頁")], "next"))
      .mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce(page([order("b", "新店餐點")], null));
    vi.stubGlobal("fetch", fetch);
    render(<AdminOrdersPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await userEvent.setup().selectOptions(screen.getByRole("combobox"), "b2");
    await screen.findByText("新店餐點");
    await act(async () => { oldPage.resolve(page([order("old", "舊店第二頁")], null)); });
    expect(screen.queryByText("舊店第一頁")).toBeNull();
    expect(screen.queryByText("舊店第二頁")).toBeNull();
    expect(screen.getByText("新店餐點")).toBeTruthy();
  });

  it.each(["success", "failure"] as const)("keeps acknowledged status while an old scan and a %s follow-up complete", async (outcome) => {
    const oldPage = deferred<Response>();
    const followup = deferred<Response>();
    let gets = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return { ok: true, status: 200 } as Response;
      gets++;
      if (gets === 1) return page([order("a", "需要備餐")], null);
      if (gets === 2) return page([order("a", "需要備餐")], "old-next");
      if (gets === 3) return oldPage.promise;
      if (gets === 4) return followup.promise;
      throw new Error("unexpected request");
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<AdminOrdersPage />);
    await screen.findByRole("button", { name: "開始備餐" });
    await user.click(screen.getByRole("button", { name: "重新整理" }));
    await waitFor(() => expect(gets).toBe(3));
    await user.click(screen.getByRole("button", { name: "開始備餐" }));
    await screen.findByRole("button", { name: "完成出餐" });
    act(() => { interval?.(); realtime.callbacks.get("orders-b1")?.(); });
    await act(async () => { oldPage.resolve(page([], null)); });
    await waitFor(() => expect(gets).toBe(4));
    expect(screen.queryByRole("button", { name: "開始備餐" })).toBeNull();
    expect(screen.getByRole("button", { name: "完成出餐" })).toBeTruthy();
    const preparing = { ...order("a", "需要備餐"), status: "preparing" };
    const result = outcome === "success" ? page([preparing], null) : ({ ok: false, status: 503, json: async () => ({ error: "暫時無法刷新" }) } as Response);
    await act(async () => { followup.resolve(result); });
    if (outcome === "failure") await screen.findByText(/訂單沒有更新成功/);
    expect(screen.queryByRole("button", { name: "開始備餐" })).toBeNull();
    expect(screen.getByRole("button", { name: "完成出餐" })).toBeTruthy();
  });
});
