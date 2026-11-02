// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoomCheckoutPanel } from "./RoomCheckoutPanel";
import { FallbackBoundary } from "./FallbackBoundary";

const view = {
  reservation: { customer_name: "王小明", booking_code: "ABC123", start_time: "2026-10-21T06:00:00Z", status: "checked_in", guest_count: 2 },
  preorder: null,
  order: { id: "o1", reservation_id: "r1", total_amount: 0, paid_at: null, order_items: [] },
  settlementsReady: false,
  billing: { start_time: "2026-10-21T06:00:00Z", end_time: "2026-10-21T08:00:00Z", status: "checked_in", total_price: 600,
    is_deposit_paid: false, next_start: null, bill: null },
};
const menu = {
  categories: [{ id: "c1", name: "咖啡" }],
  items: [{ id: "m1", category_id: "c1", name: "拿鐵", price: 150, is_available: true, options: [] }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const html = (status: number) => new Response("<html>An error occurred</html>", { status, headers: { "Content-Type": "text/html" } });

function renderPanel(onClose: () => void = () => undefined) {
  return render(<RoomCheckoutPanel reservationId="r1" roomName="A 廳" branchId="b1" nowMs={Date.parse("2026-10-21T07:00:00Z")}
    onClose={onClose} onChanged={() => undefined} />);
}

beforeEach(() => { sessionStorage.removeItem("sunrise:add-outcomes:v1"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("RoomCheckoutPanel load failures", () => {
  it("shows a retry button instead of a blank panel when the reservation fails to load (non-JSON 504), and recovers", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/menu")) return json(menu);
      calls += 1;
      return calls === 1 ? html(504) : json(view);
    }));
    renderPanel();
    expect(await screen.findByRole("heading", { name: "載入失敗" })).toBeTruthy();
    expect(screen.getByText("系統暫時有問題，請稍後再試")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(await screen.findByRole("heading", { name: "王小明" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重試" })).toBeNull();
  });

  it("says the menu failed (with retry) instead of showing empty category tabs", async () => {
    let menuCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/menu")) { menuCalls += 1; return menuCalls === 1 ? json({ error: "boom" }, 500) : json(menu); }
      return json(view);
    }));
    renderPanel();
    expect(await screen.findByText(/菜單載入失敗/)).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "菜單種類" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    await waitFor(() => expect(screen.getByRole("tablist", { name: "菜單種類" })).toBeTruthy());
    expect(screen.getByRole("button", { name: /拿鐵/ })).toBeTruthy();
  });

  it("explains an empty branch menu rather than an empty category", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/menu") ? json({ categories: [], items: [] }) : json(view)));
    renderPanel();
    expect(await screen.findByText(/這間分店還沒有可以點的品項/)).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "菜單種類" })).toBeNull();
  });
});

describe("RoomCheckoutPanel add submission", () => {
  it("sends one request for repeated clicks before rendering, then permits a deliberate second order", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    let finish: (response: Response) => void = () => { throw new Error("not initialized"); };
    const first = new Promise<Response>((resolve) => { finish = resolve; });
    let postCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menu));
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1 ? first : Promise.resolve(json({ ok: true, ...view }));
      }
      return Promise.resolve(json(view));
    }));
    renderPanel();
    const button = await screen.findByRole("button", { name: /拿鐵/ });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(postCount).toBe(1);
    await act(async () => { finish(json({ ok: true, ...view })); await first; });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(postCount).toBe(2));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("不一定屬於目前訂位"));
  });

  it("releases the in-flight guard when a request fails", async () => {
    let postCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menu));
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(json({ ok: true, ...view }));
      }
      return Promise.resolve(json(view));
    }));
    renderPanel();
    const button = await screen.findByRole("button", { name: /拿鐵/ });
    fireEvent.click(button);
    await screen.findByText(/上次加點結果未確認，原請求可能稍後完成/);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    vi.stubGlobal("confirm", vi.fn(() => true));
    fireEvent.click(button);
    await waitFor(() => expect(postCount).toBe(2));
  });

  it("requires explicit acknowledgement before sending again after an unknown response", async () => {
    let postCount = 0;
    let reads = 0;
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menu));
      if (init?.method === "POST") {
        postCount++;
        return Promise.resolve(postCount === 2 ? json({ error: "缺少餐點", add_outcome: "not_attempted" }, 400) : json({}));
      }
      reads++;
      return Promise.resolve(json(view));
    }));
    renderPanel();
    const button = await screen.findByRole("button", { name: /拿鐵/ });
    fireEvent.click(button);
    await screen.findByText(/上次加點結果未確認，原請求可能稍後完成/);
    fireEvent.click(screen.getByRole("button", { name: "重新載入訂單" }));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByText(/上次加點結果未確認，原請求可能稍後完成/)).toBeTruthy();
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(postCount).toBe(1);
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    await waitFor(() => expect(postCount).toBe(2));
    await screen.findByText("缺少餐點");
    expect(screen.getByText(/上次加點結果未確認，原請求可能稍後完成/)).toBeTruthy();
    confirm.mockReturnValue(false);
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(postCount).toBe(2);
  });

  it("keeps a validated view and marks the committed add stale when its reload is incomplete", async () => {
    let getCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menu));
      if (init?.method === "POST") return Promise.resolve(json({ ok: true, order: { id: "o1" }, billing: { end_time: view.billing.end_time } }));
      getCount++;
      return Promise.resolve(json(getCount === 1 ? view : { ...view, billing: { end_time: view.billing.end_time } }));
    }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /拿鐵/ }));
    await screen.findByText(/上次加點已完成，但畫面未更新/);
    expect(screen.getByRole("heading", { name: "王小明" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新載入訂單" })).toBeTruthy();
  });

  it.each(["missing", "null", "no order"])("does not replace known items when reload has %s", async (kind) => {
    let reads = 0;
    const original = { ...view, order: { ...view.order, order_items: [{ id: "item1", item_name: "已點蛋糕", quantity: 1,
      unit_price: 120, served_at: null, selected_options: [] }] } };
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menu));
      if (init?.method === "POST") return Promise.resolve(json({ ok: true, committed: true, refresh_failed: true }));
      reads++;
      return Promise.resolve(json(reads === 1 ? original : { ...view, order: kind === "no order" ? null : { id: "o1", paid_at: null,
        ...(kind === "null" ? { order_items: null } : {}) } }));
    }));
    renderPanel();
    expect(await screen.findByText("已點蛋糕")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /拿鐵/ }));
    await screen.findByText(/上次加點已完成，但畫面未更新/);
    expect(screen.getByText("已點蛋糕")).toBeTruthy();
    expect(screen.queryByText(/還沒點餐/)).toBeNull();
  });

  it("shows the committed warning before the following GET has resolved", async () => {
    let getCount = 0;
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menu));
      if (init?.method === "POST") return Promise.resolve(json({ ok: true, committed: true, refresh_failed: true }));
      getCount++;
      return getCount === 1 ? Promise.resolve(json(view)) : pending;
    }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /拿鐵/ }));
    await screen.findByText(/上次加點已完成，但畫面未更新/);
    expect(getCount).toBe(2);
    await act(async () => { finish(json(view)); await pending; });
    await waitFor(() => expect(screen.queryByText(/上次加點已完成，但畫面未更新/)).toBeNull());
  });

  it("distinguishes a committed add from a failed subsequent reload", async () => {
    let getCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menu));
      if (init?.method === "POST") return Promise.resolve(json({ ok: true, committed: true, refresh_failed: true }));
      getCount++;
      return getCount === 1 || getCount >= 4 ? Promise.resolve(json(view)) : Promise.reject(new Error("offline"));
    }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /拿鐵/ }));
    await screen.findByText(/上次加點已完成，但畫面未更新/);
    expect(screen.queryByText(/上次加點結果未確認/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新載入訂單" }));
    await waitFor(() => expect(getCount).toBe(3));
    expect(screen.getByText(/上次加點已完成，但畫面未更新/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新載入訂單" }));
    await waitFor(() => expect(screen.queryByText(/上次加點已完成，但畫面未更新/)).toBeNull());
  });

  it("cannot dismiss the option picker while the add is being sent", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const onClose = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const menuWithOption = { ...menu, items: [{ ...menu.items[0], options: [{ id: "op1", option_name: "冰", price_delta: 0 }] }] };
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menuWithOption));
      return init?.method === "POST" ? pending : Promise.resolve(json(view));
    }));
    renderPanel(onClose);
    fireEvent.click(await screen.findByRole("button", { name: /拿鐵/ }));
    fireEvent.click(screen.getByRole("button", { name: "加入" }));
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "送出中…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("不會取消"));
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { finish(json({ ok: true, ...view })); await pending; });
  });
});

describe("FallbackBoundary", () => {
  it("renders the fallback when a child throws (e.g. the 3D chunk failed to load)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Boom = () => { throw new Error("ChunkLoadError"); };
    render(<FallbackBoundary fallback={<p>平面圖</p>}><Boom /></FallbackBoundary>);
    expect(screen.getByText("平面圖")).toBeTruthy();
    spy.mockRestore();
  });
});


describe("anonymous same-tab warning", () => {
  it("survives panel unmount while a request is pending and blocks an unconfirmed resend", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    let posts = 0;
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menu));
      if (init?.method === "POST") { posts++; return pending; }
      return Promise.resolve(json(view));
    }));
    const first = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /拿鐵/ }));
    expect(posts).toBe(1);
    const stored = sessionStorage.getItem("sunrise:add-outcomes:v1")!;
    expect(stored).toContain("pending");
    expect(stored).not.toMatch(/王小明|ABC123|r1|A 廳|拿鐵/);
    first.unmount();
    renderPanel();
    expect(await screen.findByText(/不一定屬於目前訂位；原請求可能稍後完成/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /拿鐵/ }));
    expect(confirm).toHaveBeenCalled();
    expect(posts).toBe(1);
    await act(async () => { finish(json({})); await pending; });
    await waitFor(() => expect(sessionStorage.getItem("sunrise:add-outcomes:v1")).toContain("unknown"));
  });
  it("clears only confirmed entries after explicit review, preserving pending", async () => {
    const { createSessionAddWarningResearch } = await import("@/lib/session-add-warning-research");
    const store = createSessionAddWarningResearch(sessionStorage);
    const a = store.begin(), b = store.begin();
    if (!a.ok || !b.ok) throw new Error("setup");
    store.mark(a.operation, "committed");
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/menu") ? json(menu) : json(view)));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "已核對所有可能相關的已提交加點" }));
    expect(store.snapshot()).toEqual({ ok: true, value: { version: 1, entries: [{ n: b.operation, status: "pending" }] } });
    expect(screen.getByText(/原請求可能稍後完成/)).toBeTruthy();
  });
  it("requires acknowledgement when the marker cannot be saved", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("unexpected POST");
      return url.startsWith("/api/menu") ? json(menu) : json(view);
    });
    vi.stubGlobal("fetch", fetch);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /拿鐵/ }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("無法保存分頁提醒"));
    expect(fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
    expect(await screen.findByText(/無法保存分頁提醒/)).toBeTruthy();
    vi.restoreAllMocks();
  });
});
