// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PreorderPage from "./page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

const id = "00000000-0000-4000-8000-000000000001";
const token = "synthetic-guest-token";
const itemA = "00000000-0000-4000-8000-000000000002";
const itemB = "00000000-0000-4000-8000-000000000003";
const row = (menu_item_id: string) => ({ menu_item_id, quantity: 1, option_ids: [], special_notes: "" });
const data = { reservation: { customer_name: "合成客人", start_time: "2099-01-01T10:00:00+08:00" }, menu: [
  { id: itemA, name: "咖啡", price: 100, options: [] },
  { id: itemB, name: "茶", price: 80, options: [] },
], preorder: null, editable: true };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const button = () => screen.getByRole("button", { name: "確認送出預製餐點" }) as HTMLButtonElement;
const show = () => { window.history.replaceState({}, "", `/book/preorder?id=${id}&token=${token}`); return render(<PreorderPage />); };

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear(); window.history.replaceState({}, "", "/"); });

describe("guest preorder recovery", () => {
  it("retries a failed read while preserving the query exit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ error: "server" }, 503)).mockResolvedValueOnce(response(data));
    vi.stubGlobal("fetch", fetchMock);
    show();
    expect((await screen.findByRole("alert")).textContent).toContain("無法載入提前選餐");
    expect(screen.getByRole("link", { name: /返回訂位管理/ }).getAttribute("href")).toBe("/book/query");
    fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
    expect(await screen.findByLabelText("選擇咖啡")).toBeTruthy();
    expect(button().disabled).toBe(false);
  });

  it.each([400, 409, 500])("keeps HTTP %i uncertain and blocks retries across reload", async (status) => {
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts += 1; return Promise.resolve(response({ error: "可能在寫入後失敗" }, status)); }
      return Promise.resolve(response(data));
    }));
    const view = show();
    fireEvent.click(await screen.findByLabelText("選擇咖啡"));
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toContain("結果尚未確認");
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(posts).toBe(1);
    expect(sessionStorage.getItem(`sunrise.preorder.pending.v1:${id}`)).toBe("pending");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(token);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("咖啡");
    view.unmount();
    show();
    await screen.findByLabelText("選擇咖啡");
    expect(screen.getByRole("alert").textContent).toContain("結果尚未確認");
    expect(button().disabled).toBe(true);
    expect(posts).toBe(1);
  });

  it("persists the guard before dispatch and blocks rapid repeat submission", async () => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { calls.push(init); return pending; }
      return Promise.resolve(response(data));
    }));
    show();
    fireEvent.click(await screen.findByLabelText("選擇咖啡"));
    const submit = button();
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(calls).toHaveLength(1);
    expect(sessionStorage.getItem(`sunrise.preorder.pending.v1:${id}`)).toBe("pending");
    expect((screen.getByPlaceholderText(/整體備註/) as HTMLTextAreaElement).disabled).toBe(true);
    await act(async () => release(response({ ok: true, preorder: { status: "submitted", draft_items: [row(itemA)], guest_notes: null, result: { already_submitted: false } } })));
    expect((await screen.findByRole("status")).textContent).toContain("已送出提前預製餐點");
    expect(sessionStorage.getItem(`sunrise.preorder.pending.v1:${id}`)).toBe("confirmed");
  });

  it("shows the server's existing items when a later choice was not applied", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => init?.method === "POST"
      ? Promise.resolve(response({ ok: true, preorder: { status: "submitted", draft_items: [row(itemB)], guest_notes: "舊備註", result: { already_submitted: true } } }))
      : Promise.resolve(response(data))));
    show();
    fireEvent.click(await screen.findByLabelText("選擇咖啡"));
    fireEvent.click(button());
    expect((await screen.findByRole("status")).textContent).toContain("新選擇未必已套用");
    expect((screen.getByLabelText("選擇咖啡") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("選擇茶") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByPlaceholderText(/整體備註/) as HTMLTextAreaElement).value).toBe("舊備註");
  });

  it("does not dispatch if session storage is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(data));
    vi.stubGlobal("fetch", fetchMock);
    show();
    await screen.findByLabelText("選擇咖啡");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("無法安全記錄"));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(button().disabled).toBe(true);
  });

  it("keeps an incomplete success response unknown", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => init?.method === "POST"
      ? Promise.resolve(response({ ok: true, preorder: { status: "submitted" } })) : Promise.resolve(response(data))));
    show();
    await screen.findByLabelText("選擇咖啡");
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toContain("結果尚未確認");
    expect(button().disabled).toBe(true);
  });
  it("leaves required options editable until the validation problem is resolved", async () => {
    const option = { id: "00000000-0000-4000-8000-000000000004", option_name: "無糖", option_group: "甜度", price_delta: 0, set_id: "set", set: { min_select: 1, max_select: 1 } };
    const withRequired = { ...data, menu: [{ ...data.menu[0], options: [option] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(withRequired)));
    show();
    fireEvent.click(await screen.findByLabelText("選擇咖啡"));
    expect(screen.getByRole("alert").textContent).toContain("請選擇");
    expect(button().disabled).toBe(true);
    const choice = screen.getByRole("radio", { name: "無糖" }) as HTMLInputElement;
    expect(choice.disabled).toBe(false);
    fireEvent.click(choice);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it("ignores a stale submit after changing the booking link", async () => {
    const idB = "00000000-0000-4000-8000-000000000009";
    let release!: (value: Response) => void;
    const oldPost = new Promise<Response>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return oldPost;
      return Promise.resolve(response(url.includes(idB) ? { ...data, reservation: { ...data.reservation, customer_name: "另一筆" } } : data));
    }));
    const view = show();
    fireEvent.click(await screen.findByLabelText("選擇咖啡"));
    fireEvent.click(button());
    expect(sessionStorage.getItem(`sunrise.preorder.pending.v1:${id}`)).toBe("pending");
    await act(async () => {
      window.history.replaceState({}, "", `/book/preorder?id=${idB}&token=other-synthetic-token`);
      view.rerender(<PreorderPage />);
    });
    expect(await screen.findByText(/另一筆/)).toBeTruthy();
    await act(async () => release(response({ ok: true, preorder: { status: "submitted", draft_items: [row(itemA)], result: { already_submitted: false } } })));
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(screen.queryByText(/已送出提前預製餐點/)).toBeNull();
    expect(sessionStorage.getItem(`sunrise.preorder.pending.v1:${id}`)).toBe("pending");
    expect(sessionStorage.getItem(`sunrise.preorder.pending.v1:${idB}`)).toBeNull();
  });

  it("rejects malformed menu data before rendering it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...data, menu: [null] })));
    show();
    expect((await screen.findByRole("alert")).textContent).toContain("無法載入提前選餐");
    expect(screen.getByRole("button", { name: "重新載入" })).toBeTruthy();
  });

  it("accepts an existing submitted record without an RPC result but does not claim the new choice was applied", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => init?.method === "POST"
      ? Promise.resolve(response({ ok: true, preorder: { status: "submitted", draft_items: [row(itemB)], guest_notes: "舊備註" } }))
      : Promise.resolve(response(data))));
    show();
    fireEvent.click(await screen.findByLabelText("選擇咖啡"));
    fireEvent.click(button());
    expect((await screen.findByRole("status")).textContent).toContain("新選擇未必已套用");
    expect((screen.getByLabelText("選擇茶") as HTMLInputElement).checked).toBe(true);
    expect(sessionStorage.getItem(`sunrise.preorder.pending.v1:${id}`)).toBe("confirmed");
  });

  it("does not show current menu or option prices as historical prices", async () => {
    const optionId = "00000000-0000-4000-8000-000000000004";
    const option = { id: optionId, option_name: "加料", option_group: "選項", price_delta: 37, set_id: null };
    const menu = [{ ...data.menu[0], options: [option] }];
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => init?.method === "POST"
      ? Promise.resolve(response({ ok: true, preorder: { status: "submitted", draft_items: [{ ...row(itemA), option_ids: [optionId] }], result: { already_submitted: true } } }))
      : Promise.resolve(response({ ...data, menu }))));
    show();
    fireEvent.click(await screen.findByLabelText("選擇咖啡"));
    expect(screen.getByText(/NT\$ 100/)).toBeTruthy();
    expect(screen.getByText(/\+37/)).toBeTruthy();
    fireEvent.click(button());
    await screen.findByRole("status");
    expect(screen.queryByText(/NT\$/)).toBeNull();
    expect(screen.queryByText(/\+37/)).toBeNull();
    expect(screen.getByText(/實際金額，請向店家核對/)).toBeTruthy();
  });

  it.each([200, 400])("ignores a stale %i response after A→B→A and a delayed new A read", async (status) => {
    const idB = "00000000-0000-4000-8000-000000000009";
    let releasePost!: (value: Response) => void;
    let releaseRead!: (value: Response) => void;
    const oldPost = new Promise<Response>((resolve) => { releasePost = resolve; });
    const newRead = new Promise<Response>((resolve) => { releaseRead = resolve; });
    let readsA = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return oldPost;
      if (url.includes(idB)) return Promise.resolve(response({ ...data, reservation: { ...data.reservation, customer_name: "另一筆" } }));
      readsA += 1;
      return readsA === 1 ? Promise.resolve(response(data)) : newRead;
    }));
    const view = show();
    fireEvent.click(await screen.findByLabelText("選擇咖啡"));
    fireEvent.click(button());
    await act(async () => {
      window.history.replaceState({}, "", `/book/preorder?id=${idB}&token=other-synthetic-token`);
      view.rerender(<PreorderPage />);
    });
    expect(await screen.findByText(/另一筆/)).toBeTruthy();
    await act(async () => {
      window.history.replaceState({}, "", `/book/preorder?id=${id}&token=${token}`);
      view.rerender(<PreorderPage />);
    });
    await act(async () => releasePost(status === 200
      ? response({ ok: true, preorder: { status: "submitted", draft_items: [row(itemA)], result: { already_submitted: false } } })
      : response({ error: "old error" }, 400)));
    expect(sessionStorage.getItem(`sunrise.preorder.pending.v1:${id}`)).toBe("pending");
    expect(screen.queryByText(/已送出提前預製餐點/)).toBeNull();
    await act(async () => releaseRead(response(data)));
    await screen.findByLabelText("選擇咖啡");
    expect(screen.getByRole("alert").textContent).toContain("結果尚未確認");
    expect(button().disabled).toBe(true);
    expect(screen.queryByText(/已送出提前預製餐點/)).toBeNull();
  });

  it("warns that a changed booking needs reconfirmation without automatically unlocking", async () => {
    sessionStorage.setItem(`sunrise.preorder.pending.v1:${id}`, "confirmed");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...data, editable: false,
      preorder: { status: "submitted", draft_items: [row(itemA)], requires_reconfirmation: true } })));
    show();
    expect((await screen.findByRole("alert")).textContent).toContain("需要重新確認");
    expect(screen.queryByText(/本分頁先前已確認有提前選餐紀錄/)).toBeNull();
    expect((screen.getByRole("button", { name: "已送出／已鎖定" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sessionStorage.getItem(`sunrise.preorder.pending.v1:${id}`)).toBe("confirmed");
  });

});
