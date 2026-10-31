// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
