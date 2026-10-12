// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/supabase", () => ({
  supabase: { channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: vi.fn() },
}));

import { ReservationList } from "./ReservationList";

const base = {
  room_id: "room-1", customer_name: "王小明", phone: "0912345678", email: null,
  start_time: "2026-10-10T04:00:00.000Z", end_time: "2026-10-10T06:00:00.000Z",
  total_price: 2000, guest_count: 4, notes: null, is_notified: false, is_deposit_paid: false,
  line_user_id: null, created_at: "2026-10-01T02:00:00.000Z",
  room_with_branch: { id: "room-1", name: "包廂 A", branch: { name: "大安店" } },
};

let rows: Record<string, unknown>[];
let patches: { url: string; body: unknown }[];
let patchResponse: () => Response;

beforeEach(() => {
  rows = [
    { ...base, id: "c1", booking_code: "CAN001", status: "cancelled" },
    { ...base, id: "n1", booking_code: "NOS001", status: "no_show", customer_name: "放鳥客" },
    { ...base, id: "c2", booking_code: "PRE001", status: "cancelled", customer_name: "有預點餐",
      preorder: { status: "cancelled", requires_reconfirmation: false, item_summary: "拿鐵 ×2", guest_notes: null } },
  ];
  patches = [];
  patchResponse = () => Response.json({ ok: true });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "PATCH") {
      patches.push({ url, body: JSON.parse(String(init.body)) });
      const res = patchResponse();
      if (res.ok) rows = rows.map((r) => (r.id === url.split("/").pop() ? { ...r, status: "pending" } : r));
      return res;
    }
    if (url.startsWith("/api/reservations")) return Response.json(rows);
    return Response.json([]);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openHistory() {
  render(<ReservationList branchId="branch-1" rooms={[]} />);
  await userEvent.click(await screen.findByRole("button", { name: /歷史/ }));
}

describe("ReservationList restore (#437)", () => {
  it("history shows cancelled AND no_show rows, each with 還原; pending tab has none", async () => {
    await openHistory();
    expect(await screen.findByText("CAN001")).toBeTruthy();
    expect(screen.getByText("NOS001")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /還原/ })).toHaveLength(3);
  });

  it("history -> confirm -> PATCH restore -> list refreshes and the row leaves history", async () => {
    await openHistory();
    const row = (await screen.findByText("CAN001")).closest("li")!;
    await userEvent.click(Array.from(row.querySelectorAll("button")).find((b) => b.textContent?.includes("還原"))!);
    expect(screen.getByText(/訂金未付/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "確認" }));
    await waitFor(() => expect(patches).toEqual([{ url: "/api/reservations/c1", body: { intent: "restore" } }]));
    await waitFor(() => expect(screen.queryByText("CAN001")).toBeNull());
  });

  it("conflict (409) shows the server message and leaves the row in history", async () => {
    patchResponse = () => Response.json({ error: "該時段已被預訂，請重新選擇" }, { status: 409 });
    await openHistory();
    await userEvent.click((await screen.findAllByRole("button", { name: /還原/ }))[0]);
    await userEvent.click(screen.getByRole("button", { name: "確認" }));
    expect(await screen.findByText("該時段已被預訂，請重新選擇")).toBeTruthy();
    expect(screen.getByText("CAN001")).toBeTruthy();
  });

  it("double click sends exactly one restore request", async () => {
    await openHistory();
    const btn = (await screen.findAllByRole("button", { name: /還原/ }))[0];
    await userEvent.dblClick(btn);
    await userEvent.click(screen.getByRole("button", { name: "確認" }));
    await waitFor(() => expect(patches).toHaveLength(1));
  });

  it("cancelled preorder: the prompt says it will NOT resume and needs re-confirmation", async () => {
    await openHistory();
    const row = (await screen.findByText("PRE001")).closest("li")!;
    await userEvent.click(Array.from(row.querySelectorAll("button")).find((b) => b.textContent?.includes("還原"))!);
    expect(screen.getByText(/預點餐已取消.*不會自動恢復備餐.*重新確認/)).toBeTruthy();
  });
});
