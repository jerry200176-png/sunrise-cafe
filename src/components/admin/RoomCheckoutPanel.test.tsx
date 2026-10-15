/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoomCheckoutPanel } from "./RoomCheckoutPanel";

const at = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00+08:00`).toISOString();

function view(bill: { due: number; refund: number }, status = "checked_in") {
  return {
    reservation: { customer_name: "客人", booking_code: "AB12", start_time: at("14:00"), status },
    preorder: null,
    order: { id: "ord-1", paid_at: null, total_amount: 360, order_items: [] },
    settlementsReady: true,
    billing: { start_time: at("14:00"), end_time: at("16:00"), status, total_price: 400, is_deposit_paid: true,
      next_start: null, deposit_refund_in_flight: false,
      bill: { hours: 2, hourlyRate: 200, isWeekend: false, roomFee: 400, foodTotal: 360, foodSettled: false, depositCredit: 200,
        due: bill.due, refund: bill.refund, bookedRoomFee: null, extensionFee: null } },
  };
}

function mockFetch(data: unknown) {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/menu")) return new Response(JSON.stringify({ items: [], categories: [] }));
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, ...(data as object) }));
    }
    return new Response(JSON.stringify(data));
  }));
  return posts;
}

function renderPanel() {
  render(<RoomCheckoutPanel reservationId="res-1" roomName="A" branchId="b1" nowMs={new Date(at("15:00")).getTime()}
    onClose={() => undefined} onChanged={() => undefined} />);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("RoomCheckoutPanel — cash change (Founder D6)", () => {
  it("shows the change for cash tendered and sends the tendered amount with the checkout", async () => {
    const posts = mockFetch(view({ due: 560, refund: 0 }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "收好錢了，結帳" }));
    fireEvent.change(screen.getByLabelText("客人給的現金"), { target: { value: "1000" } });
    expect(screen.getByText("找零 NT$ 440")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /收 NT\$ 1,000，找 NT\$ 440，結帳/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ action: "checkout", expected_due: 560, payment_method: "cash", cash_tendered: 1000 });
  });

  it("blocks checkout when the cash tendered is below the bill", async () => {
    mockFetch(view({ due: 560, refund: 0 }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "收好錢了，結帳" }));
    fireEvent.change(screen.getByLabelText("客人給的現金"), { target: { value: "500" } });
    expect(screen.getByRole("alert").textContent).toMatch(/比要收的少/);
    expect((screen.getByRole("button", { name: /確定收到/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the change field for non-cash methods and never sends a tendered amount", async () => {
    const posts = mockFetch(view({ due: 560, refund: 0 }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "收好錢了，結帳" }));
    fireEvent.change(screen.getByLabelText("客人給的現金"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("radio", { name: "刷卡" }));
    expect(screen.queryByLabelText("客人給的現金")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /確定收到/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty("cash_tendered");
  });

  it("offers no change field when the deposit has to be refunded (a refund is not change)", async () => {
    mockFetch(view({ due: 0, refund: 150 }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "收好錢了，結帳" }));
    expect(screen.queryByLabelText("客人給的現金")).toBeNull();
  });

  it("keeps the cash checkout button disabled until the cash tendered is entered (Founder A6-7)", async () => {
    const posts = mockFetch(view({ due: 560, refund: 0 }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "收好錢了，結帳" }));
    const pay = screen.getByRole("button", { name: /確定收到/ }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("客人給的現金"), { target: { value: "560" } });
    expect(pay.disabled).toBe(false);
    fireEvent.click(pay);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ cash_tendered: 560 });
  });

  it("requires the cash tendered when recording an unpaid food bill in cash", async () => {
    const posts = mockFetch(view({ due: 0, refund: 0 }, "completed"));
    renderPanel();
    const record = await screen.findByRole("button", { name: /補記/ }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("客人給的現金"), { target: { value: "500" } });
    expect(screen.getByText("找零 NT$ 140")).toBeDefined();
    fireEvent.click(record);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ action: "settle", payment_method: "cash", cash_tendered: 500 });
  });
});
