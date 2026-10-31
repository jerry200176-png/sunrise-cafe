// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReservationList } from "./ReservationList";
import { beginReservationMutation, clearReservationMutationUnknown, endReservationMutation, markReservationMutationUnknown, reservationMutationsSnapshot } from "@/lib/admin-reservation-mutation-lock";

const realtime = vi.hoisted(() => ({ handlers: [] as Array<(payload?: { new?: { id?: string }; old?: { id?: string } }) => void> }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  channel: () => {
    const channel = { on: (_type: string, _filter: unknown, callback: (payload?: { new?: { id?: string }; old?: { id?: string } }) => void) => { realtime.handlers.push(callback); return channel; }, subscribe: () => channel };
    return channel;
  },
  removeChannel: () => undefined,
} }));

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

afterEach(() => {
  cleanup();
  for (const [id, state] of reservationMutationsSnapshot()) {
    if (state.outcome === "unknown") clearReservationMutationUnknown(id, state);
    else endReservationMutation(id);
  }
  vi.unstubAllGlobals(); realtime.handlers.length = 0;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function list(items: typeof rows) {
  return Response.json({ items, nextCursor: null, total: items.length, warnings: [] });
}

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

describe("branch-scoped reservation requests", () => {
  it.each(["inflight", "unknown"])("preserves a payment draft when the reservation is %s", async (outcome) => {
    mockFetch();
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    const selected = await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    const row = selected.closest("li")!;
    act(() => { beginReservationMutation("one", "b1", "A01"); });
    expect((within(row).getByRole("button", { name: /核准訂金/ }) as HTMLButtonElement).disabled).toBe(true);
    act(() => { endReservationMutation("one"); });
    await user.click(within(row).getByRole("button", { name: /核准訂金/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("帳號末五碼"), { target: { value: "12345" } });
    fireEvent.change(within(dialog).getByLabelText("備註（選填）"), { target: { value: "保留草稿" } });
    act(() => {
      beginReservationMutation("one", "b1", "A01");
      if (outcome === "unknown") markReservationMutationUnknown("one");
    });
    expect(within(dialog).getByRole("alert").textContent).toContain("目前輸入已保留");
    expect((within(dialog).getByRole("button", { name: "確認" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(within(dialog).getByRole("button", { name: "確認" }).closest("form")!);
    expect((within(dialog).getByLabelText("帳號末五碼") as HTMLInputElement).value).toBe("12345");
    await user.click(within(dialog).getByRole("button", { name: "暫時收起並核對" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      const state = reservationMutationsSnapshot().get("one")!;
      if (state.outcome === "unknown") clearReservationMutationUnknown("one", state);
      else endReservationMutation("one");
    });
    await user.click(screen.getByRole("button", { name: "回到未送出的付款資料" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "已核對最新資料，繼續編輯" })).toBeTruthy());
    expect((within(screen.getByRole("dialog")).getByLabelText("帳號末五碼") as HTMLInputElement).value).toBe("12345");
    expect((within(screen.getByRole("dialog")).getByLabelText("備註（選填）") as HTMLInputElement).value).toBe("保留草稿");
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("retains a payment draft after a failed refresh and prevents approval if the row disappears", async () => {
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") === "active") {
          reads++;
          if (reads === 2) return Response.json({ error: "無法讀取" }, { status: 503 });
          return list(reads === 1 ? rows : [rows[1]]);
        }
        return list([]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    const selected = await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(within(selected.closest("li")!).getByRole("button", { name: /核准訂金/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("帳號末五碼"), { target: { value: "12345" } });
    act(() => { realtime.handlers.at(-1)?.({ new: { id: "one" } }); });
    await screen.findByRole("button", { name: "重新讀取" });
    expect((within(dialog).getByLabelText("帳號末五碼") as HTMLInputElement).value).toBe("12345");
    await user.click(screen.getByRole("button", { name: "重新讀取" }));
    await waitFor(() => expect(reads).toBe(3));
    expect(within(dialog).queryByRole("button", { name: "已核對最新資料，繼續編輯" })).toBeNull();
    expect((within(dialog).getByRole("button", { name: "確認" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText("帳號末五碼") as HTMLInputElement).value).toBe("12345");
  });

  it.each(["one", "unrelated"])("preserves and requires review of payment input after realtime (%s)", async (changedId) => {
    const refreshed = deferred<Response>();
    const latest = { ...rows[0], is_deposit_paid: true, deposit_paid_on: "2026-10-21", deposit_last_five: "54321", deposit_payment_note: "其他人更新" };
    let reads = 0;
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes.push(JSON.parse(String(init.body))); return Response.json({ ok: true }); }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") === "active") return ++reads === 1 ? list(rows) : refreshed.promise;
        return list([]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    const selected = await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(within(selected.closest("li")!).getByRole("button", { name: /核准訂金/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("匯款日期"), { target: { value: "2026-10-20" } });
    fireEvent.change(within(dialog).getByLabelText("帳號末五碼"), { target: { value: "12345" } });
    fireEvent.change(within(dialog).getByLabelText("備註（選填）"), { target: { value: "未完成筆記" } });
    act(() => { realtime.handlers.at(-1)?.({ new: { id: changedId } }); });
    expect((within(dialog).getByRole("button", { name: "確認" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(within(dialog).getByRole("button", { name: "確認" }).closest("form")!);
    expect(writes).toHaveLength(0);
    await waitFor(() => expect(reads).toBe(2));
    expect((within(screen.getByRole("dialog")).getByLabelText("帳號末五碼") as HTMLInputElement).value).toBe("12345");
    await act(async () => { refreshed.resolve(list([latest, rows[1]])); await refreshed.promise; });
    const updatedDialog = await screen.findByRole("dialog");
    expect(within(updatedDialog).getByRole("alert").textContent).toContain("已付訂金");
    expect(within(updatedDialog).getByRole("alert").textContent).toContain("54321");
    expect((within(updatedDialog).getByLabelText("匯款日期") as HTMLInputElement).value).toBe("2026-10-20");
    expect((within(updatedDialog).getByLabelText("帳號末五碼") as HTMLInputElement).value).toBe("12345");
    expect((within(updatedDialog).getByLabelText("備註（選填）") as HTMLInputElement).value).toBe("未完成筆記");
    expect((within(updatedDialog).getByRole("button", { name: "確認" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(updatedDialog).getByRole("button", { name: "已核對最新資料，繼續編輯" }));
    expect(within(updatedDialog).getByRole("heading").textContent).toBe("修改付款資料");
    expect((within(updatedDialog).getByLabelText("帳號末五碼") as HTMLInputElement).value).toBe("12345");
    await user.click(within(updatedDialog).getByRole("button", { name: "確認" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ deposit_paid_on: "2026-10-20", deposit_last_five: "12345", deposit_payment_note: "未完成筆記" });
  });

  it("invalidates an unfinished history request after leaving the tab and receiving realtime", async () => {
    const oldRequest = deferred<Response>();
    const historical = { ...rows[0], id: "historical", status: "completed" };
    let historyReads = 0;
    let activeReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") === "history") return ++historyReads === 1 ? oldRequest.promise : list([{ ...historical, customer_name: "新讀取" }]);
        activeReads++;
        return list(rows);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    await waitFor(() => expect(historyReads).toBe(1));
    await user.click(screen.getByRole("button", { name: /^待審核/ }));
    act(() => { realtime.handlers.at(-1)?.(); });
    await waitFor(() => expect(activeReads).toBeGreaterThanOrEqual(2));
    await act(async () => { oldRequest.resolve(list([{ ...historical, customer_name: "延遲舊資料" }])); await oldRequest.promise; });
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    expect(await screen.findByText("新讀取")).toBeTruthy();
    expect(screen.queryByText("延遲舊資料")).toBeNull();
  });

  it("waits for previously loaded history before unblocking after realtime", async () => {
    const old = { ...rows[0], status: "completed", customer_name: "歷史舊值" };
    const historyRefresh = deferred<Response>();
    let historyReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") === "history") return ++historyReads === 1 ? list([old]) : historyRefresh.promise;
        return list(rows);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    await screen.findByText("歷史舊值");
    await user.click(screen.getByRole("button", { name: /^待審核/ }));
    act(() => { realtime.handlers.at(-1)?.(); });
    await waitFor(() => expect(historyReads).toBe(2));
    expect(screen.getByText("載入中…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "編輯訂位" })).toBeNull();
    await act(async () => { historyRefresh.resolve(list([{ ...old, customer_name: "歷史新值" }])); await historyRefresh.promise; });
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    expect(await screen.findByText("歷史新值")).toBeTruthy();
    expect(screen.queryByText("歷史舊值")).toBeNull();
  });

  it("keeps history unavailable after a realtime refresh failure until a successful retry", async () => {
    const old = { ...rows[0], status: "completed", customer_name: "失敗前資料" };
    let historyReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") === "history") {
          historyReads++;
          if (historyReads === 2) return Response.json({ error: "暫時無法讀取" }, { status: 503 });
          return list([{ ...old, customer_name: historyReads === 1 ? "失敗前資料" : "重試後資料" }]);
        }
        return list([]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    await screen.findByText("失敗前資料");
    act(() => { realtime.handlers.at(-1)?.(); });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("失敗前資料")).toBeNull();
    expect(screen.queryByRole("button", { name: "檢視/編輯訂位" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "重試" }));
    expect(await screen.findByText("重試後資料")).toBeTruthy();
  });

  it("keeps the realtime refresh barrier when switching tabs during debounce", async () => {
    let activeReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") === "active") { activeReads++; return list(rows); }
        return list([]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByText("甲");
    act(() => { realtime.handlers.at(-1)?.(); });
    expect(screen.getByText("資料正在更新，請稍候並重新確認。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "歷史紀錄" }));
    await waitFor(() => expect(activeReads).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByText("資料正在更新，請稍候並重新確認。")).toBeNull());
  });

  it("invalidates an open focused edit immediately on realtime and requires reopening", async () => {
    const focusId = "11111111-1111-4111-8111-111111111111";
    const old = { ...rows[0], id: focusId, status: "completed", customer_name: "編輯舊值" };
    const updated = deferred<Response>();
    let focusReads = 0;
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes++; return Response.json({ ok: true }); }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("id") === focusId) return ++focusReads === 1 ? list([old]) : updated.promise;
        return list([]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" focusReservationId={focusId} rooms={[]} />);
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("編輯舊值"), { target: { value: "尚未儲存" } });
    act(() => { realtime.handlers.at(-1)?.({ new: { id: focusId } }); });
    expect(within(dialog).getByRole("alert").textContent).toContain("請關閉並重新開啟");
    expect((within(dialog).getByRole("button", { name: "儲存" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(within(dialog).getByRole("button", { name: "儲存" }).closest("form")!);
    expect(writes).toBe(0);
    await waitFor(() => expect(focusReads).toBe(2));
    await act(async () => { updated.resolve(list([{ ...old, customer_name: "編輯新值" }])); await updated.promise; });
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByDisplayValue("尚未儲存")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "儲存" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "關閉" }));
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    await user.click(await screen.findByRole("button", { name: "檢視/編輯訂位" }));
    expect(within(await screen.findByRole("dialog")).getByDisplayValue("編輯新值")).toBeTruthy();
    expect(writes).toBe(0);
  });

  it("rechecks an out-of-range focused record on realtime refresh", async () => {
    const focusId = "11111111-1111-4111-8111-111111111111";
    const old = { ...rows[0], id: focusId, status: "completed", customer_name: "即時舊值" };
    const updated = deferred<Response>();
    let focusReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("id") === focusId) return ++focusReads === 1 ? list([old]) : updated.promise;
        return list([]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" focusReservationId={focusId} rooms={[]} />);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "關閉" }));
    act(() => { realtime.handlers.at(-1)?.(); });
    await waitFor(() => expect(focusReads).toBe(2));
    expect(screen.getByText("載入中…")).toBeTruthy();
    expect(screen.queryByText("即時舊值")).toBeNull();
    await act(async () => { updated.resolve(list([{ ...old, customer_name: "即時新值" }])); await updated.promise; });
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    expect(await screen.findByText("即時新值")).toBeTruthy();
    expect(screen.queryByText("即時舊值")).toBeNull();
  });

  it("clears the old focused record and editor when the focus id changes", async () => {
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const second = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("id") === firstId) return list([{ ...rows[0], id: firstId, status: "completed", customer_name: "第一筆" }]);
        if (p.get("id") === secondId) return second.promise;
        return list([]);
      }
      return Response.json([]);
    }));
    const view = render(<ReservationList branchId="b1" focusReservationId={firstId} rooms={[]} />);
    expect(within(await screen.findByRole("dialog")).getByDisplayValue("第一筆")).toBeTruthy();
    view.rerender(<ReservationList branchId="b1" focusReservationId={secondId} rooms={[]} />);
    await waitFor(() => expect(screen.queryByDisplayValue("第一筆")).toBeNull());
    await act(async () => { second.resolve(list([{ ...rows[1], id: secondId, status: "completed", customer_name: "第二筆" }])); await second.promise; });
    expect(within(await screen.findByRole("dialog")).getByDisplayValue("第二筆")).toBeTruthy();
    expect(screen.queryByDisplayValue("第一筆")).toBeNull();
  });

  it("does not start a competing focus lookup while verification is already checking it", async () => {
    const focusId = "11111111-1111-4111-8111-111111111111";
    const item = { ...rows[0], status: "confirmed" };
    const focusVerification = deferred<Response>();
    let focusReads = 0;
    let changed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { changed = true; return Response.json({ ok: true }); }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("id") === focusId) return ++focusReads === 1 ? list([]) : focusVerification.promise;
        return list(changed ? [] : [item]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" focusReservationId={focusId} rooms={[]} />);
    await waitFor(() => expect(focusReads).toBe(1));
    await user.click(screen.getByRole("button", { name: "即將到來" }));
    await user.click(await screen.findByRole("button", { name: /已完成/ }));
    await waitFor(() => expect(focusReads).toBe(2));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(focusReads).toBe(2);
    await act(async () => { focusVerification.resolve(list([])); await focusVerification.promise; });
    expect(screen.queryByText("無法核對訂位資料，請重試。")).toBeNull();
  });

  it("rechecks an out-of-range focused reservation before showing an edit result", async () => {
    const focusId = "11111111-1111-4111-8111-111111111111";
    const old = { ...rows[0], id: focusId, status: "completed", customer_name: "舊值" };
    const refreshedFocus = deferred<Response>();
    let focusReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Response.json({ ok: true });
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("id") === focusId) return ++focusReads === 1 ? list([old]) : refreshedFocus.promise;
        return list([]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" focusReservationId={focusId} rooms={[]} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("舊值"), { target: { value: "新值" } });
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(focusReads).toBe(2));
    expect(screen.getByText("載入中…")).toBeTruthy();
    expect(screen.queryByText("舊值")).toBeNull();
    await act(async () => { refreshedFocus.resolve(list([{ ...old, customer_name: "新值" }])); await refreshedFocus.promise; });
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    expect(await screen.findByText("新值")).toBeTruthy();
    expect(screen.queryByText("舊值")).toBeNull();
  });

  it("removes an out-of-range focused reservation after deletion", async () => {
    const focusId = "11111111-1111-4111-8111-111111111111";
    const item = { ...rows[0], id: focusId, status: "completed", customer_name: "舊歷史" };
    let deleted = false;
    let focusReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") { deleted = true; return Response.json({ ok: true }); }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("id") === focusId) { focusReads += 1; return list(deleted ? [] : [item]); }
        return list([]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" focusReservationId={focusId} rooms={[]} />);
    const editDialog = await screen.findByRole("dialog");
    await user.click(within(editDialog).getByRole("button", { name: "關閉" }));
    await user.click(screen.getByRole("button", { name: "歷史紀錄" }));
    expect(await screen.findByText("舊歷史")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /刪除/ }));
    const confirm = screen.getByRole("dialog");
    const buttons = within(confirm).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(focusReads).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByText("舊歷史")).toBeNull());
    expect(deleted).toBe(true);
  });

  it("fails closed when a focused reservation cannot be rechecked", async () => {
    const focusId = "11111111-1111-4111-8111-111111111111";
    const item = { ...rows[0], id: focusId, status: "completed", customer_name: "待核對" };
    let focusReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Response.json({ ok: true });
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("id") === focusId) {
          focusReads += 1;
          return focusReads === 2 ? Response.json({ error: "unavailable" }, { status: 503 }) : list([item]);
        }
        return list([]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" focusReservationId={focusId} rooms={[]} />);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(await screen.findByText("無法核對訂位資料，請重試。")).toBeTruthy();
    expect(screen.queryByDisplayValue("待核對")).toBeNull();
    await user.click(screen.getByRole("button", { name: "重試" }));
    await waitFor(() => expect(focusReads).toBe(3));
    expect(screen.queryByText("無法核對訂位資料，請重試。")).toBeNull();
  });

  it("discards a history request started before a later mutation", async () => {
    const oldHistory = deferred<Response>();
    const item = { ...rows[0], status: "confirmed" };
    let historyReads = 0;
    let changed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { changed = true; return Response.json({ ok: true }); }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") === "history") return ++historyReads === 1 ? oldHistory.promise : list([{ ...item, status: "completed", customer_name: "最新歷史" }]);
        return list(changed ? [] : [item]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    await waitFor(() => expect(historyReads).toBe(1));
    await user.click(screen.getByRole("button", { name: "即將到來" }));
    await user.click(await screen.findByRole("button", { name: /已完成/ }));
    await waitFor(() => expect(changed).toBe(true));
    await act(async () => { oldHistory.resolve(list([{ ...item, status: "cancelled", customer_name: "過時歷史" }])); await oldHistory.promise; });
    expect(screen.queryByText("過時歷史")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
    expect(await screen.findByText("最新歷史")).toBeTruthy();
    expect(screen.queryByText("過時歷史")).toBeNull();
  });

  it("requires explicit staff review before clearing an uncertain outcome", async () => {
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes += 1; return Response.json({ error: "unknown" }, { status: 500 }); }
      if (url.startsWith("/api/reservations?")) return list([rows[0]]);
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(screen.getByRole("button", { name: /✅ 確認/ }));
    expect(await screen.findByText(/以下訂位的操作結果尚未確認/)).toBeTruthy();
    const pending = screen.getByRole("button", { name: /✅ 確認/ }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "核對後解除待確認" }));
    let dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect((screen.getByRole("button", { name: /✅ 確認/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "核對後解除待確認" }));
    dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("原請求仍可能稍後完成");
    const buttons = within(dialog).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(screen.queryByText(/以下訂位的操作結果尚未確認/)).toBeNull());
    expect((await screen.findByRole("button", { name: /✅ 確認/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(writes).toBe(1);
  });

  it.each([
    ["edit", "network"], ["edit", "timeout"], ["edit", "bad body"], ["edit", "wrong shape"], ["edit", "server"],
    ["restore", "network"], ["restore", "timeout"], ["restore", "bad body"], ["restore", "wrong shape"], ["restore", "server"],
    ["delete", "network"], ["delete", "timeout"], ["delete", "bad body"], ["delete", "wrong shape"], ["delete", "server"],
  ])("holds %s after an uncertain %s result until staff review", async (action, failure) => {
    const verify = deferred<Response>();
    const item = { ...rows[0], status: action === "restore" ? "cancelled" : "confirmed" };
    let reads = 0;
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH" || init?.method === "DELETE") {
        writes += 1;
        if (failure === "network") throw new Error("lost");
        if (failure === "timeout") throw Object.assign(new Error("timeout"), { name: "AbortError" });
        if (failure === "bad body") return new Response("not-json", { status: 200 });
        if (failure === "wrong shape") return Response.json("not-an-object");
        return Response.json({ error: "server failed" }, { status: 500 });
      }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") === "history") return list(action === "restore" ? [item] : []);
        reads += 1;
        if (reads === 1) return list(action === "restore" ? [] : [item]);
        return verify.promise;
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    if (action === "restore") {
      await user.click(await screen.findByRole("button", { name: "歷史紀錄" }));
      await user.click(await screen.findByRole("button", { name: /一鍵還原/ }));
      const dialog = screen.getByRole("dialog");
      const buttons = within(dialog).getAllByRole("button");
      await user.click(buttons[buttons.length - 1]);
    } else {
      await user.click(await screen.findByRole("button", { name: "即將到來" }));
      if (action === "edit") {
        await user.click(await screen.findByRole("button", { name: "編輯訂位" }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "儲存" }));
      } else {
        await user.click(await screen.findByRole("button", { name: /刪除/ }));
        const dialog = screen.getByRole("dialog");
        const buttons = within(dialog).getAllByRole("button");
        await user.click(buttons[buttons.length - 1]);
      }
    }
    await waitFor(() => expect(writes).toBe(1));
    expect(await screen.findByText("載入中…")).toBeTruthy();
    await act(async () => { verify.resolve(list(action === "restore" ? [] : [item])); await verify.promise; });
    expect(await screen.findByText(/以下訂位的操作結果尚未確認/)).toBeTruthy();
    const guarded = action === "restore"
      ? await screen.findByRole("button", { name: /一鍵還原/ })
      : await screen.findByRole("button", { name: "編輯訂位" });
    expect((guarded as HTMLButtonElement).disabled).toBe(true);
    await user.click(guarded);
    expect(writes).toBe(1);
  });

  it.each([{}, { items: [null] }, null])("does not accept a malformed successful verification read: %j", async (badPayload) => {
    const background = deferred<Response>();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Response.json({ error: "failed" }, { status: 500 });
      if (url.startsWith("/api/reservations?")) {
        reads += 1;
        return reads === 1 ? list([rows[0]]) : reads === 2 ? Response.json(badPayload) : background.promise;
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(screen.getByRole("button", { name: /✅ 確認/ }));
    expect(await screen.findByText("無法載入訂位，請重試")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /選取 甲 A01/ })).toBeNull();
    act(() => { realtime.handlers.at(-1)?.(); });
    await waitFor(() => expect(reads).toBe(3));
    expect(screen.getByText("載入中…")).toBeTruthy();
    await act(async () => { background.resolve(list([rows[0]])); await background.promise; });
    expect(await screen.findByRole("checkbox", { name: /選取 甲 A01/ })).toBeTruthy();
    expect(screen.getByText(/以下訂位的操作結果尚未確認/)).toBeTruthy();
  });

  it("stays fail-closed when the newest post-mutation read fails, including the next background refresh", async () => {
    const firstMutation = deferred<Response>();
    const secondMutation = deferred<Response>();
    const olderRead = deferred<Response>();
    const latestRead = deferred<Response>();
    const backgroundRead = deferred<Response>();
    let activeReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && url.endsWith("/one")) return firstMutation.promise;
      if (init?.method === "PATCH" && url.endsWith("/two")) return secondMutation.promise;
      if (url.startsWith("/api/reservations?")) {
        activeReads += 1;
        if (activeReads === 1) return list(rows);
        if (activeReads === 2) return olderRead.promise;
        if (activeReads === 3) return latestRead.promise;
        if (activeReads === 4) return backgroundRead.promise;
        return list([rows[0], { ...rows[1], status: "confirmed" }]);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    const firstRow = (await screen.findByRole("checkbox", { name: /選取 甲 A01/ })).closest("li")!;
    await user.click(within(firstRow).getByRole("button", { name: /✅ 確認/ }));
    const secondRow = screen.getByRole("checkbox", { name: /選取 乙 B02/ }).closest("li")!;
    await user.click(within(secondRow).getByRole("button", { name: /✅ 確認/ }));
    await act(async () => { firstMutation.resolve(Response.json({ error: "first failed" }, { status: 500 })); await firstMutation.promise; });
    await waitFor(() => expect(activeReads).toBe(2));
    await act(async () => { secondMutation.resolve(Response.json({ ok: true })); await secondMutation.promise; });
    await waitFor(() => expect(activeReads).toBe(3));
    await act(async () => { latestRead.resolve(Response.json({ error: "最新讀取失敗" }, { status: 503 })); await latestRead.promise; });
    expect(await screen.findByText("最新讀取失敗")).toBeTruthy();
    await act(async () => { olderRead.resolve(list(rows)); await olderRead.promise; });
    expect(screen.getByText("最新讀取失敗")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /選取 甲 A01/ })).toBeNull();
    act(() => { realtime.handlers.at(-1)?.(); });
    await waitFor(() => expect(activeReads).toBe(4));
    expect(screen.getByText("載入中…")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /選取 乙 B02/ })).toBeNull();
    await act(async () => { backgroundRead.resolve(list([rows[0], { ...rows[1], status: "confirmed" }])); await backgroundRead.promise; });
    expect(await screen.findByRole("checkbox", { name: /選取 甲 A01/ })).toBeTruthy();
    expect(screen.queryByText("最新讀取失敗")).toBeNull();
  });

  it("refreshes after one reservation fails without reverting another reservation's success", async () => {
    const first = deferred<Response>();
    let secondSaved = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && url.endsWith("/one")) return first.promise;
      if (init?.method === "PATCH" && url.endsWith("/two")) { secondSaved = true; return Response.json({ ok: true }); }
      if (url.startsWith("/api/reservations?")) return list([rows[0], { ...rows[1], status: secondSaved ? "confirmed" : "pending" }]);
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    const firstRow = (await screen.findByRole("checkbox", { name: /選取 甲 A01/ })).closest("li")!;
    await user.click(within(firstRow).getByRole("button", { name: /✅ 確認/ }));
    const secondRow = screen.getByRole("checkbox", { name: /選取 乙 B02/ }).closest("li")!;
    await user.click(within(secondRow).getByRole("button", { name: /✅ 確認/ }));
    await waitFor(() => expect(secondSaved).toBe(true));
    await user.click(screen.getByRole("button", { name: "即將到來" }));
    await screen.findByRole("checkbox", { name: /選取 乙 B02/ });
    await act(async () => { first.resolve(Response.json({ error: "first failed" }, { status: 500 })); await first.promise; });
    expect(await screen.findByRole("checkbox", { name: /選取 乙 B02/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /選取 甲 A01/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /待審核/ }));
    expect(await screen.findByRole("checkbox", { name: /選取 甲 A01/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /選取 乙 B02/ })).toBeNull();
  });

  it("closes and disables stale message previews while the reservation is being changed", async () => {
    const notification = deferred<Response>();
    let sends = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/branches") return Response.json([{ id: "b1", name: "甲店", payment_info: "測試", line_pay_url: null }]);
      if (url.endsWith("/message-actions")) return Response.json({ text: "舊預覽" });
      if (url === "/api/reservations/send-line" && init?.method === "POST") { sends += 1; return notification.promise; }
      if (url.startsWith("/api/reservations?")) return list([rows[0]]);
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    const messageButton = screen.getByRole("button", { name: /訊息工作台/ }) as HTMLButtonElement;
    const copyButton = screen.getByRole("button", { name: /複製繳費通知/ }) as HTMLButtonElement;
    await waitFor(() => expect(copyButton.disabled).toBe(false));
    await user.click(messageButton);
    expect(await screen.findByRole("heading", { name: "訊息工作台" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /重送 LINE 繳費/ }));
    expect(screen.queryByRole("heading", { name: "訊息工作台" })).toBeNull();
    expect(messageButton.disabled).toBe(true);
    expect(copyButton.disabled).toBe(true);
    expect(sends).toBe(1);
    await act(async () => { notification.resolve(Response.json({ ok: true })); await notification.promise; });
  });

  it("tells staff to reconcile an uncertain LINE result and never retries automatically", async () => {
    let sends = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/reservations/send-line" && init?.method === "POST") { sends += 1; throw new Error("network lost"); }
      if (url.startsWith("/api/reservations?")) return list([rows[0]]);
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(screen.getByRole("button", { name: /重送 LINE 繳費/ }));
    expect(await screen.findByText("無法確認 LINE 是否已接受，請先核對通知紀錄，勿立即重送。")).toBeTruthy();
    expect(sends).toBe(1);
  });

  it("disables payment text on config failure and enables it only after a successful retry", async () => {
    let requests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/branches") {
        requests += 1;
        return requests === 1 ? Response.json({ error: "unavailable" }, { status: 503 })
          : Response.json([{ id: "b1", name: "甲店", payment_info: "甲店測試匯款資訊", line_pay_url: null }]);
      }
      if (url.startsWith("/api/reservations?")) return list([rows[0]]);
      return Response.json([]);
    }));
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<ReservationList branchId="b1" rooms={[]} />);
    expect(await screen.findByText(/無法讀取或無權查看分店繳費設定/)).toBeTruthy();
    const copy = screen.getByRole("button", { name: /複製繳費通知/ }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "重試" }));
    await waitFor(() => expect(copy.disabled).toBe(false));
    await user.click(copy);
    expect(write.mock.calls[0][0]).toContain("甲店測試匯款資訊");
    expect(requests).toBe(2);
  });

  it("invalidates a pending preview when selection changes in the same branch", async () => {
    const oldPreview = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/message-actions/batch")) return oldPreview.promise;
      if (url.startsWith("/api/reservations?")) return list(rows);
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("checkbox", { name: /選取 甲 A01/ }));
    await user.click(screen.getByRole("button", { name: "批次複製訂金訊息" }));
    expect((screen.getByRole("button", { name: "產生預覽中…" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /選取 乙 B02/ }));
    await act(async () => { oldPreview.resolve(Response.json({ batch_id: "old", items: [], combined_text: "old selection" })); await oldPreview.promise; });
    expect(screen.queryByRole("heading", { name: "批次複製訂金訊息" })).toBeNull();
    expect(screen.queryByText("old selection")).toBeNull();
    expect((screen.getByRole("button", { name: "批次複製訂金訊息" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("invalidates an in-flight preview when its selected reservation starts a mutation", async () => {
    const preview = deferred<Response>();
    const mutation = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/message-actions/batch")) return preview.promise;
      if (init?.method === "PATCH") return mutation.promise;
      if (url.startsWith("/api/reservations?")) return list([rows[0]]);
      return Response.json([]);
    }));
    const user = userEvent.setup();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("checkbox", { name: /選取 甲 A01/ }));
    await user.click(screen.getByRole("button", { name: "批次複製訂金訊息" }));
    await user.click(screen.getByRole("button", { name: /✅ 確認/ }));
    await act(async () => { preview.resolve(Response.json({ batch_id: "old", items: [], combined_text: "stale" })); await preview.promise; });
    expect(screen.queryByRole("heading", { name: "批次複製訂金訊息" })).toBeNull();
    expect(screen.queryByText("stale")).toBeNull();
    await act(async () => { mutation.resolve(Response.json({ ok: true })); await mutation.promise; });
  });

  it("holds a notification for the same reservation across A → B → A remounts", async () => {
    const pending = deferred<Response>();
    let sends = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/reservations/send-line" && init?.method === "POST") { sends += 1; return pending.promise; }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        return list(p.get("scope") === "active" ? [p.get("branchId") === "b1" ? rows[0] : rows[1]] : []);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    let view = render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(screen.getByRole("button", { name: /重送 LINE 繳費/ }));
    await waitFor(() => expect(sends).toBe(1));
    view.unmount();
    view = render(<ReservationList branchId="b2" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 乙 B02/ });
    view.unmount();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByText(/此訂位正在處理，請稍候並重新確認資料/);
    const button = screen.getByRole("button", { name: "處理中…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(sends).toBe(1);
    await act(async () => { pending.resolve(Response.json({ ok: true })); await pending.promise; });
    expect(await screen.findByRole("button", { name: /重送 LINE 繳費/ })).toBeTruthy();
    expect(sends).toBe(1);
  });

  it("holds an edit across A → B → A and refreshes before reopening it", async () => {
    const pending = deferred<Response>();
    let writes = 0;
    let updated = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes += 1; return pending.promise; }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        const row = p.get("branchId") === "b1" ? { ...rows[0], status: "confirmed", customer_name: updated ? "甲已更新" : "甲" } : { ...rows[1], status: "confirmed" };
        return list(p.get("scope") === "active" ? [row] : []);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    let view = render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("button", { name: "即將到來" }));
    await user.click(await screen.findByRole("button", { name: "編輯訂位" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("甲"), { target: { value: "甲已更新" } });
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(writes).toBe(1));
    view.unmount();
    view = render(<ReservationList branchId="b2" rooms={[]} />);
    await user.click(await screen.findByRole("button", { name: "即將到來" }));
    view.unmount();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("button", { name: "即將到來" }));
    expect((await screen.findByRole("button", { name: "編輯訂位" }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes).toBe(1);
    await act(async () => { updated = true; pending.resolve(Response.json({ ok: true })); await pending.promise; });
    await screen.findByText("甲已更新");
    expect((screen.getByRole("button", { name: "編輯訂位" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "編輯訂位" }));
    expect(within(screen.getByRole("dialog")).getByDisplayValue("甲已更新")).toBeTruthy();
    expect(writes).toBe(1);
  });

  it("refreshes when a stale mutation completes before the revisited branch's first list response", async () => {
    const mutation = deferred<Response>();
    const staleList = deferred<Response>();
    const freshList = deferred<Response>();
    let aRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return mutation.promise;
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") !== "active") return list([]);
        if (p.get("branchId") !== "b1") return list([rows[1]]);
        aRequests += 1;
        return aRequests === 1 ? list([rows[0]]) : aRequests === 2 ? staleList.promise : freshList.promise;
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    let view = render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(screen.getByRole("button", { name: /✅ 確認/ }));
    view.unmount();
    view = render(<ReservationList branchId="b2" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 乙 B02/ });
    view.unmount();
    render(<ReservationList branchId="b1" rooms={[]} />);
    await waitFor(() => expect(aRequests).toBe(2));
    await act(async () => { mutation.resolve(Response.json({ ok: true })); await mutation.promise; });
    await waitFor(() => expect(aRequests).toBe(3));
    await act(async () => { staleList.resolve(list([rows[0]])); await staleList.promise; });
    expect(screen.getByText("載入中…")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /選取 甲 A01/ })).toBeNull();
    await act(async () => { freshList.resolve(list([{ ...rows[0], status: "confirmed" }])); await freshList.promise; });
    await user.click(await screen.findByRole("button", { name: "即將到來" }));
    expect(await screen.findByRole("checkbox", { name: /選取 甲 A01/ })).toBeTruthy();
  });

  it("does not let a prior branch's late notification response unlock the new branch request", async () => {
    const oldSend = deferred<Response>();
    const newSend = deferred<Response>();
    let sends = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/reservations/send-line" && init?.method === "POST") return ++sends === 1 ? oldSend.promise : newSend.promise;
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        return list(p.get("scope") === "active" ? [p.get("branchId") === "b1" ? rows[0] : rows[1]] : []);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    const view = render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(screen.getByRole("button", { name: /重送 LINE 繳費/ }));
    await waitFor(() => expect(sends).toBe(1));
    await user.click(screen.getByRole("button", { name: "處理中…" }));
    expect(sends).toBe(1);
    view.rerender(<ReservationList branchId="b2" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 乙 B02/ });
    await user.click(screen.getByRole("button", { name: /重送 LINE 繳費/ }));
    await waitFor(() => expect(sends).toBe(2));
    await act(async () => { oldSend.resolve(Response.json({ ok: true })); await oldSend.promise; });
    expect((screen.getByRole("button", { name: "處理中…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("LINE 平台已接受繳費通知（不代表客人手機已收到）")).toBeNull();
    await act(async () => { newSend.resolve(Response.json({ ok: true })); await newSend.promise; });
    expect(await screen.findByText("LINE 平台已接受繳費通知（不代表客人手機已收到）")).toBeTruthy();
    expect(sends).toBe(2);
  });

  it.each(["error", "network failure"])("does not roll old branch rows back into the new branch after a late mutation %s", async (outcome) => {
    const pending = deferred<Response>();
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes += 1; return pending.promise; }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        return list(p.get("scope") === "active" ? [p.get("branchId") === "b1" ? rows[0] : rows[1]] : []);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    const view = render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(screen.getByRole("button", { name: /✅ 確認/ }));
    await waitFor(() => expect(writes).toBe(1));
    view.rerender(<ReservationList branchId="b2" rooms={[]} />);
    expect(await screen.findByRole("checkbox", { name: /選取 乙 B02/ })).toBeTruthy();
    await act(async () => {
      if (outcome === "network failure") pending.reject(new Error("old failure"));
      else pending.resolve(Response.json({ error: "old mutation error" }, { status: 500 }));
      await pending.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("checkbox", { name: /選取 甲 A01/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /選取 乙 B02/ })).toBeTruthy();
    expect(screen.queryByText("old mutation error")).toBeNull();
    expect(screen.queryByText("連線失敗，狀態未更新")).toBeNull();
  });

  it("cancels the old branch confirmation when the branch changes without sending a mutation", async () => {
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes += 1; return Response.json({ ok: true }); }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        return list(p.get("scope") === "active" ? [p.get("branchId") === "b1" ? rows[0] : rows[1]] : []);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    const view = render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(screen.getByRole("button", { name: /拒絕/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(<ReservationList branchId="b2" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 乙 B02/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes).toBe(0);
  });

  it("clears the old branch's payment instructions before the new branch config loads", async () => {
    const nextConfig = deferred<Response>();
    let configRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/branches") {
        configRequests += 1;
        return configRequests === 1
          ? Response.json([{ id: "b1", name: "甲店", payment_info: "甲店測試匯款資訊", line_pay_url: null }])
          : nextConfig.promise;
      }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        return list(p.get("scope") === "active" ? [p.get("branchId") === "b1" ? rows[0] : rows[1]] : []);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const view = render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    await user.click(screen.getByRole("button", { name: /複製繳費通知/ }));
    expect(write.mock.calls[0][0]).toContain("甲店測試匯款資訊");
    view.rerender(<ReservationList branchId="b2" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 乙 B02/ });
    expect((screen.getByRole("button", { name: /複製繳費通知/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      nextConfig.resolve(Response.json([{ id: "b2", name: "乙店", payment_info: "乙店測試匯款資訊", line_pay_url: null }]));
      await nextConfig.promise;
    });
    await user.click(screen.getByRole("button", { name: /複製繳費通知/ }));
    expect(write.mock.calls[1][0]).not.toContain("甲店測試匯款資訊");
    expect(write.mock.calls[1][0]).toContain("乙店測試匯款資訊");
    expect(configRequests).toBe(2);
  });

  it("ignores delayed payment instructions from the previous branch", async () => {
    const oldConfig = deferred<Response>();
    let configRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/branches") {
        configRequests += 1;
        return configRequests === 1 ? oldConfig.promise : Response.json([{ id: "b2", name: "乙店", payment_info: "乙店測試匯款資訊", line_pay_url: null }]);
      }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        return list(p.get("scope") === "active" ? [p.get("branchId") === "b1" ? rows[0] : rows[1]] : []);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const view = render(<ReservationList branchId="b1" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 甲 A01/ });
    view.rerender(<ReservationList branchId="b2" rooms={[]} />);
    await screen.findByRole("checkbox", { name: /選取 乙 B02/ });
    await act(async () => {
      oldConfig.resolve(Response.json([{ id: "b1", name: "甲店", payment_info: "甲店測試匯款資訊", line_pay_url: null }]));
      await oldConfig.promise;
    });
    await user.click(screen.getByRole("button", { name: /複製繳費通知/ }));
    expect(write.mock.calls[0][0]).toContain("乙店測試匯款資訊");
    expect(write.mock.calls[0][0]).not.toContain("甲店測試匯款資訊");
  });

  it.each(["success", "error"])("discards an older A %s after A → B → A without clearing the latest loading state", async (outcome) => {
    const oldA = deferred<Response>();
    const newA = deferred<Response>();
    let aRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        if (p.get("scope") !== "active") return list([]);
        if (p.get("branchId") === "b1") return ++aRequests === 1 ? oldA.promise : newA.promise;
        return list([rows[1]]);
      }
      return Response.json([]);
    }));
    const view = render(<ReservationList branchId="b1" rooms={[]} />);
    await waitFor(() => expect(aRequests).toBe(1));
    view.rerender(<ReservationList branchId="b2" rooms={[]} />);
    expect(await screen.findByRole("checkbox", { name: /選取 乙 B02/ })).toBeTruthy();
    view.rerender(<ReservationList branchId="b1" rooms={[]} />);
    await waitFor(() => expect(aRequests).toBe(2));
    expect(screen.queryByRole("checkbox", { name: /選取 乙 B02/ })).toBeNull();
    await act(async () => {
      oldA.resolve(outcome === "success" ? list([rows[1]]) : Response.json({ error: "old error" }, { status: 503 }));
      await oldA.promise;
    });
    expect(screen.queryByText("old error")).toBeNull();
    expect(screen.getByText("載入中…")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /選取 甲 A01/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /選取 乙 B02/ })).toBeNull();
    await act(async () => { newA.resolve(list([rows[0]])); await newA.promise; });
    expect(await screen.findByRole("checkbox", { name: /選取 甲 A01/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /選取 乙 B02/ })).toBeNull();
  });

  it.each(["success", "error"])("ignores a stale batch preview %s and preserves the new request's loading state", async (oldOutcome) => {
    const oldPreview = deferred<Response>();
    const newPreview = deferred<Response>();
    const previews: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/message-actions/batch")) {
        const body = JSON.parse(String(init?.body));
        previews.push(body.reservation_ids[0]);
        return body.reservation_ids[0] === "one" ? oldPreview.promise : newPreview.promise;
      }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        return list(p.get("scope") === "active" ? [p.get("branchId") === "b1" ? rows[0] : rows[1]] : []);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    const view = render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("checkbox", { name: /選取 甲 A01/ }));
    await user.click(screen.getByRole("button", { name: "批次複製訂金訊息" }));
    await waitFor(() => expect(previews).toEqual(["one"]));
    view.rerender(<ReservationList branchId="b2" rooms={[]} />);
    await user.click(await screen.findByRole("checkbox", { name: /選取 乙 B02/ }));
    await user.click(screen.getByRole("button", { name: "批次複製訂金訊息" }));
    await waitFor(() => expect(previews).toEqual(["one", "two"]));
    const oldResponse = oldOutcome === "success"
      ? Response.json({ batch_id: "old", items: [], combined_text: "old secret" })
      : Response.json({ error: "old error" }, { status: 500 });
    await act(async () => { oldPreview.resolve(oldResponse); await oldPreview.promise; });
    expect(screen.queryByText("old error")).toBeNull();
    expect(screen.queryByText("old secret")).toBeNull();
    expect(screen.queryByRole("heading", { name: "批次複製訂金訊息" })).toBeNull();
    expect((screen.getByRole("button", { name: "產生預覽中…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      newPreview.resolve(Response.json({ batch_id: "new", can_batch_copy: true, warnings: [],
        items: [{ reservation_id: "two", customer_name: "乙", booking_code: "B02", date_label: "測試", text: "new preview" }], combined_text: "new preview" }));
      await newPreview.promise;
    });
    expect(await screen.findByRole("heading", { name: "批次複製訂金訊息" })).toBeTruthy();
    expect(screen.getByText(/訂位碼：B02/)).toBeTruthy();
    expect(previews).toEqual(["one", "two"]);
  });

  it("does not revive an old batch preview after A → B → A", async () => {
    const oldA = deferred<Response>();
    const oldB = deferred<Response>();
    const newA = deferred<Response>();
    let countA = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/message-actions/batch")) {
        const id = JSON.parse(String(init?.body)).reservation_ids[0];
        if (id === "two") return oldB.promise;
        return ++countA === 1 ? oldA.promise : newA.promise;
      }
      if (url.startsWith("/api/reservations?")) {
        const p = new URL(url, "http://localhost").searchParams;
        return list(p.get("scope") === "active" ? [p.get("branchId") === "b1" ? rows[0] : rows[1]] : []);
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    const view = render(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("checkbox", { name: /選取 甲 A01/ }));
    await user.click(screen.getByRole("button", { name: "批次複製訂金訊息" }));
    await waitFor(() => expect(countA).toBe(1));
    view.rerender(<ReservationList branchId="b2" rooms={[]} />);
    await user.click(await screen.findByRole("checkbox", { name: /選取 乙 B02/ }));
    await user.click(screen.getByRole("button", { name: "批次複製訂金訊息" }));
    view.rerender(<ReservationList branchId="b1" rooms={[]} />);
    await user.click(await screen.findByRole("checkbox", { name: /選取 甲 A01/ }));
    await user.click(screen.getByRole("button", { name: "批次複製訂金訊息" }));
    await waitFor(() => expect(countA).toBe(2));
    await act(async () => {
      oldA.resolve(Response.json({ batch_id: "old", items: [], combined_text: "old A" }));
      oldB.resolve(Response.json({ error: "old B" }, { status: 500 }));
      await Promise.all([oldA.promise, oldB.promise]);
    });
    expect(screen.queryByText("old A")).toBeNull();
    expect(screen.queryByText("old B")).toBeNull();
    expect((screen.getByRole("button", { name: "產生預覽中…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      newA.resolve(Response.json({ batch_id: "new", can_batch_copy: true, warnings: [],
        items: [{ reservation_id: "one", customer_name: "甲", booking_code: "A01", date_label: "測試", text: "new" }], combined_text: "new" }));
      await newA.promise;
    });
    expect(await screen.findByRole("heading", { name: "批次複製訂金訊息" })).toBeTruthy();
    expect(screen.getByText(/訂位碼：A01/)).toBeTruthy();
  });
});
