// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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

function renderPanel() {
  return render(<RoomCheckoutPanel reservationId="r1" roomName="A 廳" branchId="b1" nowMs={Date.parse("2026-10-21T07:00:00Z")}
    onClose={() => undefined} onChanged={() => undefined} />);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("RoomCheckoutPanel load failures", () => {
  it("holds further actions after a committed add until the order refresh succeeds", async () => {
    localStorage.clear();
    let getCount = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return json(menu);
      if (init?.method === "POST") return json({ ok: true, committed: true, refresh_failed: true });
      getCount += 1;
      return getCount === 2 ? html(503) : json(view);
    });
    vi.stubGlobal("fetch", fetcher);
    renderPanel();
    const item = await screen.findByRole("button", { name: /拿鐵/ });
    fireEvent.click(item);
    expect(await screen.findByText(/加點已完成，但訂單畫面未更新/)).toBeTruthy();
    expect((item as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(item);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "重新載入訂單" }));
    await waitFor(() => expect((item as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/加點已完成，但訂單畫面未更新/)).toBeNull();
  });
  it("sends a quick double tap once without leaving an error after success", async () => {
    localStorage.clear();
    let resolvePost!: (response: Response) => void;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu")) return Promise.resolve(json(menu));
      if (init?.method === "POST") return post;
      return Promise.resolve(json(view));
    });
    vi.stubGlobal("fetch", fetcher);
    renderPanel();
    const item = await screen.findByRole("button", { name: /拿鐵/ });
    act(() => { item.click(); item.click(); });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await act(async () => { resolvePost(json({ ok: true, ...view })); });
    await waitFor(() => expect((item as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/加點仍在處理|請先處理待確認/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
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

describe("FallbackBoundary", () => {
  it("renders the fallback when a child throws (e.g. the 3D chunk failed to load)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Boom = () => { throw new Error("ChunkLoadError"); };
    render(<FallbackBoundary fallback={<p>平面圖</p>}><Boom /></FallbackBoundary>);
    expect(screen.getByText("平面圖")).toBeTruthy();
    spy.mockRestore();
  });
});
