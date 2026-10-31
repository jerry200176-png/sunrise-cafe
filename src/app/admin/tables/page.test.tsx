// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const branchState = vi.hoisted(() => ({ branches: [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }] }));
vi.mock("@/lib/use-admin-branches", () => ({
  useAdminBranches: () => ({ ...branchState, loading: false, error: null, retry: vi.fn() }),
}));

import AdminTablesPage from "./page";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const initial = { id: "t1", branch_id: "b1", number: "A1", is_active: true, qr_token: "synthetic" };

afterEach(() => { cleanup(); sessionStorage.clear(); branchState.branches = [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }]; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("桌位編輯與停用", () => {
  it("確認歷史顯示影響後才更新桌號，保留 QR", async () => {
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        writes.push(JSON.parse(String(init.body)));
        return json({ id: "t1", number: "A2", is_active: true });
      }
      if (input.endsWith("/qr")) return json({ qr_data_url: "data:image/png;base64,AAAA", order_url: "https://example.invalid/order/synthetic" });
      return json([initial]);
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminTablesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "顯示 QR" }));
    expect(await screen.findByAltText("桌 A1 QR 碼")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "編輯桌號 A1" }));
    fireEvent.change(screen.getByLabelText("新桌號"), { target: { value: "A2" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存桌號" }));
    expect(await screen.findByText("桌號 A2")).toBeTruthy();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("既有訂單"));
    expect(writes).toEqual([{ expected: { number: "A1", is_active: true }, number: "A2" }]);
    expect(screen.getByAltText("桌 A2 QR 碼")).toBeTruthy();
  });

  it("停用要確認，重新啟用沿用同一桌位", async () => {
    let row = { ...initial };
    const writes: Array<{ expected: { number: string; is_active: boolean }; is_active: boolean }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)); writes.push(body);
        row = { ...row, is_active: body.is_active };
        return json({ id: row.id, number: row.number, is_active: row.is_active });
      }
      return json([row]);
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AdminTablesPage />);
    const disable = await screen.findByRole("button", { name: "停用桌號 A1" });
    fireEvent.click(disable);
    expect(writes).toHaveLength(0);
    fireEvent.click(disable);
    expect(await screen.findByText("已停用")).toBeTruthy();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("已在途的訂單仍可能完成"));
    fireEvent.click(screen.getByRole("button", { name: "啟用桌號 A1" }));
    expect(await screen.findByText("使用中")).toBeTruthy();
    expect(writes).toEqual([
      { expected: { number: "A1", is_active: true }, is_active: false },
      { expected: { number: "A1", is_active: false }, is_active: true },
    ]);
  });

  it("寫入衝突時重新取得資料而不自動重送", async () => {
    let reads = 0, writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes++; return json({ error: "桌位已變更，請重新整理" }, 409); }
      reads++;
      return json([{ ...initial, number: reads === 1 ? "A1" : "A9" }]);
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminTablesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "停用桌號 A1" }));
    expect(await screen.findByText("桌號 A9")).toBeTruthy();
    expect(writes).toBe(1);
  });

  it("寫入結果不明時鎖住操作，必須重新讀取並明確確認", async () => {
    let writes = 0, reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes++; throw new TypeError("network lost"); }
      reads++;
      if (reads === 2) return json({ error: "暫時無法讀取" }, 503);
      return json([initial]);
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminTablesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "停用桌號 A1" }));
    const warning = await screen.findByText(/桌位操作結果尚未確認/);
    expect((screen.getByRole("button", { name: "停用桌號 A1" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(warning.parentElement!).getByRole("button", { name: "重新整理並核對" }));
    expect(await screen.findByText("暫時無法讀取")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "已核對，允許操作" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新整理並核對" }));
    fireEvent.click(await screen.findByRole("button", { name: "已核對，允許操作" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("原請求仍可能稍後完成"));
    await waitFor(() => expect((screen.getByRole("button", { name: "停用桌號 A1" }) as HTMLButtonElement).disabled).toBe(false));
    expect(writes).toBe(1);
  });

  it("新增結果不明時，同分頁重新載入仍保留鎖定而不保存桌號或 QR", async () => {
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") { writes++; throw new TypeError("network lost"); }
      return json([initial]);
    }));
    render(<AdminTablesPage />);
    fireEvent.change(await screen.findByPlaceholderText("桌號，例：A1、B3"), { target: { value: "NEW-TABLE" } });
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    expect(await screen.findByText(/桌位操作結果尚未確認/)).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem("sunrise.table-write.pending.v1")!)).toMatchObject({ branchId: "b1", operationId: expect.any(String) });
    expect(JSON.stringify(sessionStorage)).not.toContain("NEW-TABLE");
    expect(JSON.stringify(sessionStorage)).not.toContain("synthetic");
    cleanup();
    render(<AdminTablesPage />);
    expect(await screen.findByText(/桌位操作結果尚未確認/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "新增" }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes).toBe(1);
  });

  it("無法保存待確認狀態時不發送桌位操作", async () => {
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes++; return json({ id: "t1", number: "A1", is_active: false }); }
      return json([initial]);
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminTablesPage />);
    const disable = await screen.findByRole("button", { name: "停用桌號 A1" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    fireEvent.click(disable);
    expect(await screen.findByText(/尚未送出請求/)).toBeTruthy();
    expect(writes).toBe(0);
  });

  it("相同桌號以識別碼區分，新增重複桌號前明示", async () => {
    const first = { ...initial, id: "11111111-1111-4111-8111-123456abcdef" };
    const duplicate = { ...initial, id: "22222222-2222-4222-8222-987654abcdef" };
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") { writes++; return json({ id: "new", number: "A1", branch_id: "b1" }); }
      return json([first, duplicate]);
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminTablesPage />);
    expect(await screen.findAllByText("此分店有相同桌號，請以識別碼核對。")).toHaveLength(2);
    expect(screen.getByText(`桌位識別碼 ${first.id}`)).toBeTruthy();
    expect(screen.getByText(`桌位識別碼 ${duplicate.id}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: `停用桌號 A1，識別碼 ${first.id}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `停用桌號 A1，識別碼 ${duplicate.id}` })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("桌號，例：A1、B3"), { target: { value: "A1" } });
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("已有相同桌號"));
    expect(writes).toBe(0);
  });

  it("原分店在請求中被移除且結果不明時，保持全域鎖且不覆寫旗標", async () => {
    let rejectWrite!: (error: Error) => void;
    const pending = new Promise<Response>((_resolve, reject) => { rejectWrite = reject; });
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return pending;
      return input.includes("branchId=b2") ? json([{ ...initial, id: "t2", branch_id: "b2", number: "B2" }]) : json([initial]);
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = render(<AdminTablesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "停用桌號 A1" }));
    const originalHold = sessionStorage.getItem("sunrise.table-write.pending.v1");
    branchState.branches = [{ id: "b2", name: "乙店" }];
    view.rerender(<AdminTablesPage />);
    await act(async () => { rejectWrite(new TypeError("network lost")); });
    expect(await screen.findByText(/無法載入原操作分店/)).toBeTruthy();
    expect((screen.getByLabelText("選擇分店") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "新增" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sessionStorage.getItem("sunrise.table-write.pending.v1")).toBe(originalHold);
  });

  it("返回後啟動新操作時，舊頁面遲到回應不能清掉新旗標", async () => {
    let resolveOld!: (response: Response) => void;
    let rejectNew!: (error: Error) => void;
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        calls++;
        return calls === 1 ? new Promise<Response>((resolve) => { resolveOld = resolve; })
          : new Promise<Response>((_resolve, reject) => { rejectNew = reject; });
      }
      return json([initial]);
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminTablesPage />);
    fireEvent.change(await screen.findByPlaceholderText("桌號，例：A1、B3"), { target: { value: "A2" } });
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    cleanup();
    render(<AdminTablesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "重新整理並核對" }));
    fireEvent.click(await screen.findByRole("button", { name: "已核對，允許操作" }));
    fireEvent.change(screen.getByPlaceholderText("桌號，例：A1、B3"), { target: { value: "A3" } });
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    const newerHold = sessionStorage.getItem("sunrise.table-write.pending.v1");
    await act(async () => { resolveOld(json({ id: "old", branch_id: "b1", number: "A2" })); });
    expect(sessionStorage.getItem("sunrise.table-write.pending.v1")).toBe(newerHold);
    await act(async () => { rejectNew(new TypeError("network lost")); });
    expect(await screen.findByText(/桌位操作結果尚未確認/)).toBeTruthy();
    expect(sessionStorage.getItem("sunrise.table-write.pending.v1")).toBe(newerHold);
  });

  it("重新載入時回到待確認的原分店；無權使用時不改以其他分店核對", async () => {
    sessionStorage.setItem("sunrise.table-write.pending.v1", JSON.stringify({ branchId: "b2", operationId: "fake-operation" }));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.includes("branchId=b2")
      ? json([{ ...initial, branch_id: "b2", number: "B2" }]) : json([initial])));
    const view = render(<AdminTablesPage />);
    expect(await screen.findByText("桌號 B2")).toBeTruthy();
    expect((screen.getByLabelText("選擇分店") as HTMLSelectElement).value).toBe("b2");
    branchState.branches = [{ id: "b1", name: "甲店" }];
    view.rerender(<AdminTablesPage />);
    expect(await screen.findByText(/無法載入原操作分店/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "重新整理並核對" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("列印既有異常桌號時會跳脫 HTML", async () => {
    const unsafe = 'A<script>alert("x")</script>';
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.endsWith("/qr")
      ? json({ qr_data_url: "data:image/png;base64,AAAA", order_url: "https://example.invalid/order/synthetic" })
      : json([{ ...initial, number: unsafe }])));
    const write = vi.fn((value: string) => value);
    vi.spyOn(window, "open").mockReturnValue({ document: { write, close: vi.fn() } } as unknown as Window);
    render(<AdminTablesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "顯示 QR" }));
    fireEvent.click(await screen.findByRole("button", { name: "列印" }));
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain("A&lt;script&gt;");
    expect(html).not.toContain(unsafe);
  });

  it("切店後不讓舊店的慢回應覆蓋新店", async () => {
    let release!: (value: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.includes("branchId=b1") ? oldResponse : json([{ ...initial, id: "t2", branch_id: "b2", number: "B2" }])));
    render(<AdminTablesPage />);
    fireEvent.change(await screen.findByLabelText("選擇分店"), { target: { value: "b2" } });
    expect(await screen.findByText("桌號 B2")).toBeTruthy();
    await act(async () => { release(json([initial])); });
    expect(screen.queryByText("桌號 A1")).toBeNull();
  });
});
