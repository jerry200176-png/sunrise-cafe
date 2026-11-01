// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReservationOrderPage from "./page";

const { mockParams } = vi.hoisted(() => ({ mockParams: { id: "res-1" } }));
vi.mock("next/navigation", () => ({ useParams: () => mockParams }));

const api = "/api/admin/reservation-orders/res-1";
const view = {
  reservation: { customer_name: "Guest", booking_code: "ABC123", start_time: "2026-10-15T06:00:00Z",
    status: "checked_in", room: { name: "A", branch_id: "b1" } },
  preorder: null,
  order: { id: "ord-1", paid_at: null, total_amount: 0, order_items: [] },
};
const menu = { items: [{ id: "m1", name: "咖啡", price: 100, is_available: true, options: [] }] };
const submitted = { action: "add_items", idempotency_key: expect.stringMatching(/^[a-f0-9-]{36}$/), items: [{ menu_item_id: "m1", quantity: 1, option_ids: [], special_notes: "" }] };

describe("standalone reservation orders — acknowledged add versus refresh (#463)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let posts: Array<Record<string, unknown>>;
  let getCount: number;
  let refreshFailure: "http" | "network" | null;
  let postStatus: number;

  beforeEach(() => {
    mockParams.id = "res-1";
    localStorage.clear();
    posts = [];
    getCount = 0;
    refreshFailure = null;
    postStatus = 200;
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu?")) return Response.json(menu);
      if (url !== api) throw new Error(`Unexpected request: ${url}`);
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return postStatus === 200
          ? Response.json({ ok: true, committed: true, refresh_failed: true })
          : Response.json({ error: "加點失敗" }, { status: postStatus });
      }
      getCount++;
      if (getCount > 1 && refreshFailure === "network") throw new TypeError("Failed to fetch");
      if (getCount > 1 && refreshFailure === "http") return Response.json({ error: "暫時無法載入" }, { status: 503 });
      return Response.json(getCount === 1 ? view : { ...view, order: { ...view.order, total_amount: 100,
        order_items: [{ id: "oi-1", item_name: "咖啡", quantity: 1, unit_price: 100, served_at: null }] } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  async function selectAndAdd() {
    render(<ReservationOrderPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "選擇咖啡" }));
    fireEvent.click(screen.getByRole("button", { name: "加入訂單" }));
  }

  it.each(["http", "network"] as const)("clears submitted selection after an acknowledged POST even when GET fails (%s)", async (failure) => {
    refreshFailure = failure;
    await selectAndAdd();
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "選擇咖啡" }) as HTMLInputElement).checked).toBe(false));
    expect((screen.getByRole("button", { name: "加入訂單" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("已加入訂單，但畫面未能更新");
    expect(screen.getByRole("status").getAttribute("aria-atomic")).toBe("true");
    expect(getCount).toBe(2);
    expect(posts).toEqual([submitted]);
    // An additional click without a new selection cannot repeat the committed add.
    fireEvent.click(screen.getByRole("button", { name: "加入訂單" }));
    expect(posts).toEqual([submitted]);
    expect((screen.getByRole("checkbox", { name: "選擇咖啡" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "記錄現場已結帳" }) as HTMLButtonElement).disabled).toBe(true);
    refreshFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "重新載入訂單" }));
    expect(await screen.findByText("咖啡 ×1")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "選擇咖啡" }) as HTMLInputElement).disabled).toBe(false);
    expect(posts).toEqual([submitted]);
  });

  it("still refreshes the displayed order and clears selection after a successful GET", async () => {
    await selectAndAdd();
    expect(await screen.findByText("咖啡 ×1")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "選擇咖啡" }) as HTMLInputElement).checked).toBe(false));
    expect(getCount).toBe(2);
    expect(posts).toEqual([submitted]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([409, 500])("retains the unknown POST %s for explicit same-key retry without refetching", async (status) => {
    postStatus = status;
    await selectAndAdd();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "選擇咖啡" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "加入訂單" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "查詢加點結果" })).toBeTruthy();
    expect(getCount).toBe(1);
    expect(posts).toEqual([submitted]);
  });

  it("keeps the existing refresh-failure behavior for other actions", async () => {
    refreshFailure = "http";
    render(<ReservationOrderPage />);
    fireEvent.click(await screen.findByRole("button", { name: "記錄現場已結帳" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(posts).toEqual([{ action: "settle" }]);
    expect(getCount).toBe(2);
  });
});

describe("standalone reservation orders — NT$0 food on an ended stay (#447 P2-2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(status: string, total: number) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/menu?")) return Response.json(menu);
      return Response.json({ ...view, reservation: { ...view.reservation, status }, order: { ...view.order, total_amount: total } });
    }));
  }

  it.each(["completed", "cancelled", "no_show"])("does not offer to record zero food on a %s stay", async (status) => {
    stub(status, 0);
    render(<ReservationOrderPage />);
    expect(await screen.findByText("沒有餐費要收")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "記錄現場已結帳" })).toBeNull();
  });

  it("still offers it when an ended stay has unpaid food", async () => {
    stub("completed", 120);
    render(<ReservationOrderPage />);
    expect(await screen.findByRole("button", { name: "記錄現場已結帳" })).toBeTruthy();
  });
});


describe("standalone reservation orders — route id race", () => {
  it("keeps the new reservation when the old GET resolves afterward", async () => {
    let releaseOld!: (response: Response) => void;
    let oldStarted!: () => void;
    const oldRequestStarted = new Promise<void>((resolve) => { oldStarted = resolve; });
    const oldResponse = new Promise<Response>((resolve) => { releaseOld = resolve; });
    const makeView = (customer_name: string, booking_code: string) => ({
      reservation: { ...view.reservation, customer_name, booking_code, room: null }, preorder: null, order: null,
    });
    const fetch = vi.fn((url: string) => {
      if (url.endsWith("/res-1")) { oldStarted(); return oldResponse; }
      if (url.endsWith("/res-2")) return Promise.resolve(Response.json(makeView("新訂位", "NEW")));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    const { rerender } = render(<ReservationOrderPage />);
    await oldRequestStarted;
    mockParams.id = "res-2";
    rerender(<ReservationOrderPage />);
    expect(await screen.findByText(/新訂位.*NEW/)).toBeTruthy();

    await act(async () => {
      releaseOld(Response.json(makeView("舊訂位", "OLD")));
      // Flush the resolved fetch continuation through load()'s stale-response guard.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText(/新訂位.*NEW/)).toBeTruthy();
    expect(screen.queryByText(/舊訂位|OLD/)).toBeNull();
  });
});
