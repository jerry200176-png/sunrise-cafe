// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realtime = vi.hoisted(() => ({
  onInsert: null as null | (() => void),
  onStatus: null as null | ((status: string) => void),
}));
const branchState = vi.hoisted(() => ({
  branches: [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }],
  loading: false,
  error: null as string | null,
}));

vi.mock("@/lib/use-admin-branches", () => ({
  useAdminBranches: () => ({
    ...branchState,
    retry: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: () => {
      const channel = {
        on: (_event: unknown, _filter: unknown, handler: () => void) => {
          realtime.onInsert = handler;
          return channel;
        },
        subscribe: (handler: (status: string) => void) => {
          realtime.onStatus = handler;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));

import PrintStationPage from "./page";

describe("print station delayed sweep lifecycle", () => {
  let orderReads: string[];
  let pendingReads: string[];
  let printRequests: string[];
  let resolvePrinter: (() => void) | null;
  let rejectPrinter: ((error: Error) => void) | null;
  let hangPrinter = false;
  let failMark = false;
  let pendingStatus: boolean | "missing" = "missing";
  let pendingStatuses: Record<string, boolean | "missing">;
  let hangPending = false;
  let releasePending: (() => void) | null;
  let markWrites = 0;

  beforeEach(() => {
    orderReads = [];
    pendingReads = [];
    printRequests = [];
    resolvePrinter = null;
    rejectPrinter = null;
    hangPrinter = false;
    failMark = false;
    pendingStatus = "missing";
    pendingStatuses = {};
    hangPending = false;
    releasePending = null;
    markWrites = 0;
    branchState.branches = [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }];
    branchState.loading = false;
    branchState.error = null;
    window.localStorage.clear();
    realtime.onInsert = null;
    realtime.onStatus = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/admin/orders?")) {
        orderReads.push(url);
        const rows = orderReads.length === 1 ? [] : [{
          id: "old-shop-order", branch_id: "b1", status: "pending", is_printed: false,
          created_at: new Date().toISOString(), total_amount: 100, order_items: [{ id: "i1", item_name: "湯", quantity: 1 }],
        }];
        return { ok: true, status: 200, json: async () => ({ items: rows, nextCursor: null }) } as Response;
      }
      if (url.includes("localhost:22222")) {
        printRequests.push(url);
        if (hangPrinter) {
          return new Promise<Response>((resolve, reject) => {
            resolvePrinter = () => resolve({ ok: true, status: 200, text: async () => "<Response/>" } as Response);
            rejectPrinter = reject;
          });
        }
        return { ok: true, status: 200, text: async () => "<Response/>" } as Response;
      }
      if (url.includes("/api/admin/orders/")) {
        if (!init?.method || init.method === "GET") {
          pendingReads.push(url);
          const parsed = new URL(url, "http://localhost");
          const branch = parsed.searchParams.get("branchId");
          const id = decodeURIComponent(parsed.pathname.split("/").pop()!);
          const status = pendingStatuses[id] ?? pendingStatus;
          if (hangPending) return new Promise<Response>((resolve) => { releasePending = () => resolve({ ok: true, status: 200, json: async () => ({ id, branch_id: branch, is_printed: true, status: "pending" }) } as Response); });
          return { ok: status !== "missing", status: status === "missing" ? 404 : 200,
            json: async () => status === "missing" ? { error: "找不到訂單" } : { id, branch_id: branch, is_printed: status, status: "pending" } } as Response;
        }
        markWrites++;
        return { ok: !failMark, status: failMark ? 500 : 200 } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([true, false, "missing"] as const)("checks only the pending id and preserves safety for status %s", async (status) => {
    pendingStatus = status;
    window.localStorage.setItem("sunrise.print.pending-ids", JSON.stringify([{ id: "pending-old", branchId: "b1" }]));
    const user = userEvent.setup();
    render(<PrintStationPage />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("pending-old"));
    await user.click(screen.getByRole("button", { name: "只檢查目前分店的列印標記" }));
    await waitFor(() => expect(pendingReads).toHaveLength(1));
    expect(pendingReads[0]).toContain("pending-old?branchId=b1");
    if (status === true) await waitFor(() => expect(window.localStorage.getItem("sunrise.print.pending-ids")).toBeNull());
    else await waitFor(() => expect(window.localStorage.getItem("sunrise.print.pending-ids")).toContain("pending-old"));
    expect(orderReads).toHaveLength(0);
    expect(printRequests).toHaveLength(0);
    expect(markWrites).toBe(0);
  });

  it("blocks manual resolution during lookup and ignores results after switching branches", async () => {
    hangPending = true;
    window.localStorage.setItem("sunrise.print.pending-ids", JSON.stringify([{ id: "pending-old", branchId: "b1" }]));
    const user = userEvent.setup();
    render(<PrintStationPage />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("pending-old"));
    await user.click(screen.getByRole("button", { name: "只檢查目前分店的列印標記" }));
    await waitFor(() => expect(pendingReads).toHaveLength(1));
    expect((screen.getByRole("button", { name: /我已核對無紙單，解除鎖定/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByRole("combobox"), "b2");
    await user.selectOptions(screen.getByRole("combobox"), "b1");
    act(() => releasePending?.());
    await waitFor(() => expect(screen.queryByRole("button", { name: "檢查中…" })).toBeNull());
    expect(window.localStorage.getItem("sunrise.print.pending-ids")).toContain("pending-old");
    expect(printRequests).toHaveLength(0);
  });

  it("retains legacy unknown and missing ids while reconciling later printed orders", async () => {
    const legacyOther = "00000000-0000-0000-0000-000000000001";
    const deleted = "00000000-0000-0000-0000-000000000002";
    const printed = "00000000-0000-0000-0000-000000000003";
    pendingStatuses = { [legacyOther]: "missing", [deleted]: "missing", [printed]: true };
    window.localStorage.setItem("sunrise.print.pending-ids", JSON.stringify([
      legacyOther, { id: deleted, branchId: "b1" }, { id: printed, branchId: "b1" },
    ]));
    const user = userEvent.setup();
    render(<PrintStationPage />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(printed));
    await user.click(screen.getByRole("button", { name: "只檢查目前分店的列印標記" }));
    await waitFor(() => expect(pendingReads).toHaveLength(3));
    await waitFor(() => expect(screen.getByText(/另有 2 筆無法確認或不屬於本店/)).toBeTruthy());
    const stored = window.localStorage.getItem("sunrise.print.pending-ids")!;
    expect(stored).toContain(legacyOther);
    expect(stored).toContain(deleted);
    expect(stored).not.toContain(printed);
    expect(printRequests).toHaveLength(0);
    expect(markWrites).toBe(0);
  });

  it("Stop then branch switch cancels queued delayed sweeps before any old-shop print", async () => {
    const user = userEvent.setup();
    render(<PrintStationPage />);
    const branchSelect = await screen.findByRole("combobox");
    await waitFor(() => expect((branchSelect as HTMLSelectElement).value).toBe("b1"));

    await user.click(screen.getByRole("button", { name: /開始監聽/ }));
    await waitFor(() => expect(realtime.onStatus).not.toBeNull());
    act(() => realtime.onStatus?.("SUBSCRIBED"));
    await waitFor(() => expect(orderReads).toHaveLength(1));

    act(() => realtime.onInsert?.());
    await user.click(screen.getByRole("button", { name: /停止/ }));
    await waitFor(() => expect((branchSelect as HTMLSelectElement).disabled).toBe(false));
    await user.selectOptions(branchSelect, "b2");

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(orderReads).toHaveLength(1);
    expect(printRequests).toHaveLength(0);
    expect((branchSelect as HTMLSelectElement).value).toBe("b2");
  });

  it("removes an unauthorized current branch before Start can read its orders", async () => {
    const user = userEvent.setup();
    const page = render(<PrintStationPage />);
    const branchSelect = await screen.findByRole("combobox");
    await waitFor(() => expect((branchSelect as HTMLSelectElement).value).toBe("b1"));

    branchState.branches = [{ id: "b2", name: "乙店" }];
    page.rerender(<PrintStationPage />);
    await waitFor(() => expect((branchSelect as HTMLSelectElement).value).toBe("b2"));
    await user.click(screen.getByRole("button", { name: /開始監聽/ }));
    await waitFor(() => expect(realtime.onStatus).not.toBeNull());
    act(() => realtime.onStatus?.("SUBSCRIBED"));
    await waitFor(() => expect(orderReads).toHaveLength(1));

    expect(orderReads[0]).toContain("branchId=b2");
    expect(orderReads.some((url) => url.includes("branchId=b1"))).toBe(false);
  });

  it("pending printer POST blocks sweeps for another branch until its result is confirmed", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    hangPrinter = true;
    render(<PrintStationPage />);
    const branchSelect = await screen.findByRole("combobox");
    await waitFor(() => expect((branchSelect as HTMLSelectElement).value).toBe("b1"));

    await user.click(screen.getByRole("button", { name: /開始監聽/ }));
    await waitFor(() => expect(realtime.onStatus).not.toBeNull());
    act(() => realtime.onStatus?.("SUBSCRIBED"));
    await waitFor(() => expect(orderReads).toHaveLength(1));
    act(() => realtime.onInsert?.());
    await waitFor(() => expect(printRequests).toHaveLength(1));
    expect(window.localStorage.getItem("sunrise.print.pending-ids")).toContain("old-shop-order");

    await user.click(screen.getByRole("button", { name: /停止/ }));
    await waitFor(() => expect((branchSelect as HTMLSelectElement).disabled).toBe(false));
    await user.selectOptions(branchSelect, "b2");
    expect((branchSelect as HTMLSelectElement).value).toBe("b2");
    expect(screen.getByRole("alert").textContent).toContain("不會自動重送");
    expect(screen.getByRole("alert").textContent).toContain("old-shop-order");
    expect((screen.getByRole("button", { name: /開始監聽/ }) as HTMLButtonElement).disabled).toBe(true);
    const confirmPrinted = screen.getByRole("button", { name: /我已核對紙單已出，手動標記已列印/ });
    const allowReprint = screen.getByRole("button", { name: /我已核對無紙單，解除鎖定/ });
    expect((confirmPrinted as HTMLButtonElement).disabled).toBe(true);
    expect((allowReprint as HTMLButtonElement).disabled).toBe(true);
    await user.click(confirmPrinted);
    await user.click(allowReprint);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(markWrites).toBe(0);
    expect(printRequests).toHaveLength(1);
    await user.selectOptions(branchSelect, "b1");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(orderReads).toHaveLength(2);
    expect(printRequests).toHaveLength(1);

    resolvePrinter?.();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("restores a pending order after remount and keeps Start locked", async () => {
    const user = userEvent.setup();
    hangPrinter = true;
    const page = render(<PrintStationPage />);
    const branchSelect = await screen.findByRole("combobox");
    await waitFor(() => expect((branchSelect as HTMLSelectElement).value).toBe("b1"));
    await user.click(screen.getByRole("button", { name: /開始監聽/ }));
    await waitFor(() => expect(realtime.onStatus).not.toBeNull());
    act(() => realtime.onStatus?.("SUBSCRIBED"));
    await waitFor(() => expect(orderReads).toHaveLength(1));
    act(() => realtime.onInsert?.());
    await waitFor(() => expect(printRequests).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /停止/ }));
    page.unmount();

    render(<PrintStationPage />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("old-shop-order"));
    expect(screen.getByRole("alert").textContent).toContain("甲店");
    expect((screen.getByRole("button", { name: /開始監聽/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(printRequests).toHaveLength(1);
  });

  it("fails closed when pending print storage is malformed", async () => {
    window.localStorage.setItem("sunrise.print.pending-ids", "{broken");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PrintStationPage />);
    await waitFor(() => expect(screen.getByText(/無法讀取列印待確認記錄/)).toBeTruthy());
    expect((screen.getByRole("button", { name: /開始監聽/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(orderReads).toHaveLength(0);
    expect(printRequests).toHaveLength(0);
    await userEvent.setup().click(screen.getByRole("button", { name: /完成全店人工核對後解除鎖定/ }));
    await waitFor(() => expect(screen.queryByText(/無法讀取列印待確認記錄/)).toBeNull());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("原請求可能仍會稍後出紙"));
    expect((screen.getByRole("button", { name: /開始監聽/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(orderReads).toHaveLength(0);
    expect(printRequests).toHaveLength(0);
  });

  it("keeps the printer locked if storage still fails during confirmed recovery", async () => {
    window.localStorage.setItem("sunrise.print.pending-ids", "{broken");
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.endsWith(".probe")) throw new Error("storage unavailable");
      return originalSet.call(this, key, value);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PrintStationPage />);
    await waitFor(() => expect(screen.getByText(/無法讀取列印待確認記錄/)).toBeTruthy());
    await userEvent.setup().click(screen.getByRole("button", { name: /完成全店人工核對後解除鎖定/ }));
    await waitFor(() => expect(screen.getByText(/儲存空間仍無法讀寫，列印維持鎖定/)).toBeTruthy());
    expect((screen.getByRole("button", { name: /開始監聽/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(orderReads).toHaveLength(0);
    expect(printRequests).toHaveLength(0);
  });

  it("retains a pending hold when the printed marker write fails", async () => {
    const user = userEvent.setup();
    failMark = true;
    render(<PrintStationPage />);
    const branchSelect = await screen.findByRole("combobox");
    await waitFor(() => expect((branchSelect as HTMLSelectElement).value).toBe("b1"));
    await user.click(screen.getByRole("button", { name: /開始監聽/ }));
    await waitFor(() => expect(realtime.onStatus).not.toBeNull());
    act(() => realtime.onStatus?.("SUBSCRIBED"));
    await waitFor(() => expect(orderReads).toHaveLength(1));
    act(() => realtime.onInsert?.());
    await waitFor(() => expect(printRequests).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/已列印，但系統未確認列印標記/)).toBeTruthy());
    expect((screen.getByRole("button", { name: /開始監聽/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(window.localStorage.getItem("sunrise.print.pending-ids")).toContain("old-shop-order");
    expect(printRequests).toHaveLength(1);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    failMark = false;
    await user.click(screen.getByRole("button", { name: /我已核對紙單已出，手動標記已列印/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("確認紙單確實已出"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("頁面曾重載"));
    expect(markWrites).toBe(2);
    expect(printRequests).toHaveLength(1);
    expect((screen.getByRole("button", { name: /開始監聽/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explicit no-paper confirmation clears the hold without printing immediately", async () => {
    const user = userEvent.setup();
    hangPrinter = true;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PrintStationPage />);
    const branchSelect = await screen.findByRole("combobox");
    await waitFor(() => expect((branchSelect as HTMLSelectElement).value).toBe("b1"));
    await user.click(screen.getByRole("button", { name: /開始監聽/ }));
    await waitFor(() => expect(realtime.onStatus).not.toBeNull());
    act(() => realtime.onStatus?.("SUBSCRIBED"));
    await waitFor(() => expect(orderReads).toHaveLength(1));
    act(() => realtime.onInsert?.());
    await waitFor(() => expect(printRequests).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /停止/ }));
    await act(async () => { rejectPrinter?.(new Error("socket closed")); });
    await waitFor(() => expect(screen.queryByText(/印表機請求仍未完成/)).toBeNull());
    await user.click(screen.getByRole("button", { name: /我已核對無紙單，解除鎖定/ }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("可能重印"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("頁面重載後狀態未知"));
    expect(window.localStorage.getItem("sunrise.print.pending-ids")).toBeNull();
    expect(printRequests).toHaveLength(1);
    expect(markWrites).toBe(0);
    expect((screen.getByRole("button", { name: /開始監聽/ }) as HTMLButtonElement).disabled).toBe(false);
    resolvePrinter?.();
  });
});
