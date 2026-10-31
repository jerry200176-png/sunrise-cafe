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

/** 模擬伺服器：active 範圍沒有未結案訂位；history 依 status 篩選（auto_cancelled 由伺服器判斷）。 */
function listBody(url: string) {
  const params = new URL(url, "http://localhost").searchParams;
  if (params.get("scope") !== "history") return { items: [], nextCursor: null, total: 0, warnings: [] };
  const status = params.get("status") ?? "all";
  const items = rows.filter((r) =>
    status === "all" ? true : status === "auto_cancelled" ? (r as { deposit_auto_cancelled?: boolean }).deposit_auto_cancelled === true : r.status === status
  );
  return { items, nextCursor: null, total: items.length, warnings: [] };
}

function mockFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = url.startsWith("/api/reservations?") ? listBody(url) : init?.method === "PATCH" ? { ok: true } : [];
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
    const calls = mockFetch();
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: /只看未付訂金自動取消/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("status=auto_cancelled"))).toBe(true));
    expect(await screen.findByRole("button", { name: /只看未付訂金自動取消（1）/ })).toBeTruthy();
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
      expect(calls.filter((c) => c.url.includes("scope=active")).length).toBeGreaterThanOrEqual(2)
    );
  });

  it("keeps a cancelled booking in history and shows the conflict when restore returns 409", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ error: "原時段已被佔用" }), { status: 409 });
      }
      const body = url.startsWith("/api/reservations?") ? listBody(url) : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await openHistory();
    fireEvent.click((await screen.findAllByRole("button", { name: /一鍵還原/ }))[0]);
    const dialog = await screen.findByRole("dialog");
    const confirmButtons = within(dialog).getAllByRole("button");
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(await screen.findByText("原時段已被佔用")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /一鍵還原/ })).toHaveLength(3);
    expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(1);
  });

  it("restores an unpaid booking and checks the guest in without changing deposit state", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const restoredRow = { ...base, id: "auto", booking_code: "AUTO01", customer_name: "甲", status: "cancelled", deposit_auto_cancelled: true };
    let status = "cancelled";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { intent?: string; status?: string };
        if (body.intent === "restore") status = "pending";
        if (body.status) status = body.status;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      const params = new URL(url, "http://localhost").searchParams;
      const items = params.get("scope") === "history"
        ? status === "cancelled" ? [restoredRow] : []
        : status === "cancelled" ? [] : [{ ...restoredRow, status, is_deposit_paid: false }];
      return new Response(JSON.stringify({ items, nextCursor: null, total: items.length, warnings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: /一鍵還原/ }));
    const dialog = await screen.findByRole("dialog");
    const confirmButtons = within(dialog).getAllByRole("button");
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(status).toBe("pending"));

    fireEvent.click(screen.getByRole("button", { name: /待審核/ }));
    fireEvent.click(await screen.findByRole("button", { name: "✅ 已到店" }));
    const checkInDialog = await screen.findByRole("dialog");
    expect(checkInDialog.textContent).toContain("甲");
    expect(checkInDialog.textContent).toContain("2026/10/20 14:00–16:00");
    expect(status).toBe("pending");
    expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(1);
    const checkInButtons = within(checkInDialog).getAllByRole("button");
    fireEvent.click(checkInButtons[checkInButtons.length - 1]);

    await waitFor(() => expect(status).toBe("checked_in"));
    const patches = calls.filter((call) => call.init?.method === "PATCH");
    expect(patches.map((patch) => JSON.parse(String(patch.init?.body)))).toEqual([
      { intent: "restore" },
      { status: "checked_in" },
    ]);
    expect(status).toBe("checked_in");
  });

  it("does not send a check-in update when the confirmation is cancelled", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const pending = { ...base, id: "restored", booking_code: "REST01", customer_name: "戊", status: "pending" };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ items: [pending], nextCursor: null, total: 1, warnings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    render(<ReservationList branchId="b1" rooms={[{ id: "room-1", name: "A 包廂" } as never]} />);
    fireEvent.click(await screen.findByRole("button", { name: "✅ 已到店" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("戊");
    expect(dialog.textContent).toContain("2026/10/20 14:00–16:00");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(0);
  });
});
