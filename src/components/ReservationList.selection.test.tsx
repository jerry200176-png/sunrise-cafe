// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReservationList } from "./ReservationList";

const base = {
  room_id: "room-1", phone: "0900", email: null, guest_count: 2, total_price: 600,
  is_deposit_paid: false, notes: null, created_at: "2026-10-01T00:00:00Z",
  start_time: "2026-10-20T06:00:00Z", end_time: "2026-10-20T08:00:00Z", status: "pending",
};
const rows = [
  { ...base, id: "one", booking_code: "A01", customer_name: "甲" },
  { ...base, id: "two", booking_code: "B02", customer_name: "乙" },
];

function mockFetch() {
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/message-actions/batch")) {
      const body = JSON.parse(String(init?.body));
      writes.push(body);
      return Response.json({ batch_id: "batch-1", can_batch_copy: true, warnings: [],
        items: [{ reservation_id: "one", customer_name: "甲", booking_code: "A01", date_label: "測試", text: "預覽" }], combined_text: "預覽" });
    }
    if (url.startsWith("/api/reservations?")) {
      const params = new URL(url, "http://localhost").searchParams;
      const items = params.get("scope") === "active" && params.get("branchId") === "b1" ? rows : [];
      return Response.json({ items, nextCursor: null, total: items.length, warnings: [] });
    }
    return Response.json([]);
  }));
  return writes;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("reservation selection visibility", () => {
  it("exposes partial, all and empty selection with the keyboard", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    const one = await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    const all = screen.getByRole("checkbox", { name: "選取目前列表訂位" }) as HTMLInputElement;
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(false);
    one.focus();
    await user.keyboard(" ");
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(true);
    expect(screen.getByText("目前清單 1 筆")).toBeTruthy();
    all.focus();
    await user.keyboard(" ");
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    expect(screen.getByText("目前清單 2 筆")).toBeTruthy();
    await user.keyboard(" ");
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(false);
    expect(screen.queryByText(/已選取/)).toBeNull();
  });

  it("shows hidden selections, previews the actual selection and clears it when branches change", async () => {
    const writes = mockFetch();
    const user = userEvent.setup();
    const view = render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("checkbox", { name: /選取 甲 A01/ }));
    await user.type(screen.getByRole("textbox", { name: "搜尋訂位" }), "乙");
    expect(screen.getByText(/目前清單 0 筆，清單外 1 筆/)).toBeTruthy();
    const all = screen.getByRole("checkbox", { name: "選取目前列表訂位" }) as HTMLInputElement;
    expect(all.indeterminate).toBe(false);
    await user.click(all);
    expect(all.checked).toBe(true);
    expect(screen.getByText(/目前清單 1 筆，清單外 1 筆/)).toBeTruthy();
    await user.click(all);
    expect(screen.getByText(/目前清單 0 筆，清單外 1 筆/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "批次複製訂金訊息" }));
    expect(await screen.findByRole("heading", { name: "批次複製訂金訊息" })).toBeTruthy();
    expect(writes).toEqual([{ reservation_ids: ["one"], template_key: "deposit_request", action: "preview" }]);
    view.rerender(<ReservationList branchId="b2" rooms={[]} />);
    await waitFor(() => expect(screen.queryByText(/已選取/)).toBeNull());
    expect(screen.queryByRole("heading", { name: "批次複製訂金訊息" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "選取目前列表訂位" }) as HTMLInputElement).disabled).toBe(true);
    expect(writes).toHaveLength(1);
  });
});
