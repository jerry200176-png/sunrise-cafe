// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReservationList } from "./ReservationList";

const base = {
  room_id: "room-1",
  phone: "0900",
  email: null,
  guest_count: 2,
  total_price: 600,
  is_deposit_paid: false,
  notes: null,
  created_at: "2026-10-01T00:00:00Z",
  start_time: "2026-10-20T06:00:00Z",
  end_time: "2026-10-20T08:00:00Z",
};
const rows = [
  { ...base, id: "auto", booking_code: "AUTO01", customer_name: "甲", status: "cancelled", deposit_auto_cancelled: true },
  { ...base, id: "manual", booking_code: "MANU01", customer_name: "乙", status: "cancelled", deposit_auto_cancelled: false },
  { ...base, id: "noshow", booking_code: "NOSH01", customer_name: "丙", status: "no_show" },
  { ...base, id: "done", booking_code: "DONE01", customer_name: "丁", status: "completed" },
];

function mockFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = url.startsWith("/api/reservations?") ? rows : init?.method === "PATCH" ? { ok: true } : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openHistory() {
  render(<ReservationList branchId="b1" rooms={[{ id: "room-1", name: "A 包廂" } as never]} />);
  fireEvent.click(await screen.findByRole("button", { name: "歷史紀錄" }));
}

describe("ReservationList history restore (一鍵還原)", () => {
  it("offers restore for cancelled and no_show bookings, not completed ones, and labels auto-cancellations", async () => {
    mockFetch();
    await openHistory();
    expect(await screen.findAllByRole("button", { name: /一鍵還原/ })).toHaveLength(3);
    expect(screen.getAllByText("未付訂金自動取消")).toHaveLength(1);
  });

  it("filters to bookings auto-cancelled for an unpaid deposit", async () => {
    mockFetch();
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: /只看未付訂金自動取消（1）/ }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /一鍵還原/ })).toHaveLength(1));
    expect(screen.getByText("AUTO01")).toBeTruthy();
    expect(screen.queryByText("MANU01")).toBeNull();
  });

  it("sends a single restore intent after confirmation and refreshes", async () => {
    const calls = mockFetch();
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: /只看未付訂金自動取消/ }));
    fireEvent.click(await screen.findByRole("button", { name: /一鍵還原/ }));
    const dialog = await screen.findByRole("dialog");
    const buttons = within(dialog).getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const patches = calls.filter((c) => c.init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toBe("/api/reservations/auto");
    expect(JSON.parse(String(patches[0].init?.body))).toEqual({ intent: "restore" });
    await waitFor(() =>
      expect(calls.filter((c) => c.url.startsWith("/api/reservations?")).length).toBeGreaterThanOrEqual(2)
    );
  });
});
