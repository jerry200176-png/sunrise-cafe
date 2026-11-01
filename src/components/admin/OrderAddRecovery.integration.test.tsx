// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReservationOrderPage from "@/app/admin/reservation-orders/[id]/page";
import { RoomCheckoutPanel } from "./RoomCheckoutPanel";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "res-1" }) }));
const menu = { categories: [{ id: "c1", name: "飲料" }], items: [{ id: "m1", name: "咖啡", price: 100, category_id: "c1", is_available: true, options: [] }] };
const view = { reservation: { customer_name: "測試客人", booking_code: "ABC123", start_time: "2026-10-15T06:00:00Z", status: "checked_in", room: { name: "A", branch_id: "b1" } }, preorder: null,
  order: { id: "o1", paid_at: null, total_amount: 0, order_items: [] },
  billing: { start_time: "2026-10-15T06:00:00Z", end_time: "2026-10-15T08:00:00Z", status: "checked_in", total_price: 100, is_deposit_paid: false, next_start: null, bill: null } };

describe("add recovery across both staff entry points", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

  it("checks the same request in the room panel after a lost response on the standalone page", async () => {
    const posts: Array<{ action: string; idempotency_key: string; items?: unknown }> = [];
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu?")) return Response.json(menu);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        if (posts.length === 1) { writes++; throw new TypeError("lost response after commit"); }
        if (body.action === "add_items") writes++;
        return Response.json({ ok: true, state: "committed" });
      }
      return Response.json(view);
    }));
    const first = render(<ReservationOrderPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "選擇咖啡" }));
    fireEvent.click(screen.getByRole("button", { name: "加入訂單" }));
    await screen.findByRole("button", { name: "查詢加點結果" });
    expect((screen.getByRole("button", { name: "加入訂單" }) as HTMLButtonElement).disabled).toBe(true);
    first.unmount();
    render(<RoomCheckoutPanel reservationId="res-1" roomName="A" branchId="b1" nowMs={Date.parse("2026-10-15T07:00:00Z")} onClose={() => {}} onChanged={() => {}} />);
    const retry = await screen.findByRole("button", { name: "查詢加點結果" });
    expect(posts).toHaveLength(1); // reopening never silently resends
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole("button", { name: "查詢加點結果" })).toBeNull());
    expect(posts).toHaveLength(2);
    expect(posts[1].idempotency_key).toBe(posts[0].idempotency_key);
    expect(posts[1].action).toBe("add_status");
    expect(posts[1].items).toBeUndefined();
    expect(writes).toBe(1);
  });

  it("does not display stored order details before reservation access is authorized", async () => {
    const key = "11111111-1111-1111-1111-111111111111";
    localStorage.setItem(`sunrise.order-add.pending.v1:res-1:${key}`, JSON.stringify({ version: 1, reservationId: "res-1", key,
      items: [{ menu_item_id: "m1", quantity: 1 }], itemNames: ["敏感餐點名稱"] }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "forbidden" }, { status: 403 })));
    render(<ReservationOrderPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/敏感餐點名稱/)).toBeNull();
    expect(screen.queryByRole("button", { name: "查詢加點結果" })).toBeNull();
  });

  it("asks for confirmation and sends only the request key when safely cancelling", async () => {
    const key = "11111111-1111-4111-8111-111111111111";
    localStorage.setItem(`sunrise.order-add.pending.v1:res-1:${key}`, JSON.stringify({ version: 2, reservationId: "res-1", key }));
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/menu?")) return Response.json(menu);
      if (init?.method === "POST") return Response.json({ ok: true, state: "canceled" });
      return Response.json(view);
    });
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ReservationOrderPage />);
    const button = await screen.findByRole("button", { name: "安全取消未完成的加點" });
    fireEvent.click(button);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(localStorage.length).toBe(1);
    fireEvent.click(button);
    await waitFor(() => expect(localStorage.length).toBe(0));
    const sent = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0][1]?.body))).toEqual({ action: "cancel_add", idempotency_key: key });
    expect((await screen.findByRole("status")).textContent).toContain("安全取消");
  });
});
