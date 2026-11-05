// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CartPage from "./page";
const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));
const params = vi.hoisted(() => ({ token: "synthetic" }));
vi.mock("next/navigation", () => ({ useParams: () => ({ tableToken: params.token }), useRouter: () => router }));
const cartKey = "cart-synthetic";
const holdKey = "qr-order.pending:synthetic";
const line = { menuItem: { id: "m1", name: "咖啡", price: 100 }, quantity: 1, selectedOptions: [], specialNotes: "" };
describe("QR cart unknown outcome", () => {
  beforeEach(() => { params.token = "synthetic"; localStorage.clear(); localStorage.setItem(cartKey, JSON.stringify([line])); router.push.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });
  it.each([
    ["connection lost", () => Promise.reject(new TypeError("lost"))],
    ["server error", () => Promise.resolve(new Response("upstream error", { status: 502 }))],
    ["malformed success", () => Promise.resolve(new Response("bad json", { status: 200 }))],
    ["success without ID", () => Promise.resolve(Response.json({ ok: true }))],
  ])("persists a hold across reload after %s and never posts again", async (_label, response) => {
    const fetcher = vi.fn(response);
    vi.stubGlobal("fetch", fetcher);
    const first = render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: "確認送出訂單" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/可能已送出.*店員確認/);
    expect(localStorage.getItem(holdKey)).toMatch(/^pending/);
    first.unmount();
    render(<CartPage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/可能已送出.*店員確認/);
    const button = screen.getByRole("button", { name: "確認送出訂單" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("allows correction after the server confirms the order was not written", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "餐點價格已變更", safe_to_retry: true }, { status: 409 })));
    render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: "確認送出訂單" }));
    expect((await screen.findByRole("alert")).textContent).toContain("價格已變更");
    await waitFor(() => expect(localStorage.getItem(holdKey)).toBeNull());
    expect((screen.getByRole("button", { name: "確認送出訂單" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("clears both cart and hold only after acknowledged order success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, orderId: "synthetic-order" })));
    render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: "確認送出訂單" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(cartKey)).toBeNull();
    expect(localStorage.getItem(holdKey)).toBeNull();
  });
  it("does not send if the hold cannot be saved", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: "確認送出訂單" }));
    expect((await screen.findByRole("alert")).textContent).toContain("請向店員確認");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains the hold after success if the cart cannot be removed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, orderId: "synthetic-order" })));
    const original = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key) {
      if (key === cartKey) throw new Error("storage unavailable");
      return original.call(this, key);
    });
    render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: "確認送出訂單" }));
    expect((await screen.findByRole("alert")).textContent).toContain("請向店員確認");
    expect(localStorage.getItem(holdKey)).toMatch(/^pending/);
    expect(router.push).not.toHaveBeenCalled();
  });
  it("requires staff confirmation before manual release and never resends automatically", async () => {
    localStorage.setItem(holdKey, "pending");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<CartPage />);
    const release = await screen.findByRole("button", { name: "請店員核對後解除" });
    fireEvent.click(release);
    expect(localStorage.getItem(holdKey)).toMatch(/^pending/);
    expect((screen.getByRole("button", { name: "確認送出訂單" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(release);
    expect(confirm.mock.calls[1][0]).toMatch(/仍可能稍後完成.*可能造成重複/);
    expect(localStorage.getItem(holdKey)).toBeNull();
    expect((screen.getByRole("button", { name: "確認送出訂單" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/自行按下送出/);
  });
  it("after reload warns that submitted allergy notes must be checked on the original order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("response lost"); }));
    const first = render(<CartPage />);
    const notes = await screen.findByPlaceholderText("有特殊需求請備註");
    fireEvent.change(notes, { target: { value: "合成過敏備註" } });
    fireEvent.click(screen.getByRole("button", { name: "確認送出訂單" }));
    await screen.findByText(/無法還原送出時的整體備註/);
    expect(localStorage.getItem(cartKey)).not.toContain("合成過敏備註");
    first.unmount();
    render(<CartPage />);
    expect((await screen.findByText(/無法還原送出時的整體備註/)).textContent).toMatch(/過敏資訊.*店員核查原訂單/);
    expect((screen.getByPlaceholderText("有特殊需求請備註") as HTMLTextAreaElement).value).toBe("");
  });
  it.each(["headers", "body"] as const)("times out stalled %s without releasing the hold", async (stall) => {
    const fetcher = vi.fn((_url: string, init: RequestInit) => stall === "headers"
      ? new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }))
      : Promise.resolve(new Response(new ReadableStream({ start() { /* deliberately never closes */ } }), { status: 200 })));
    vi.stubGlobal("fetch", fetcher);
    render(<CartPage />);
    const button = await screen.findByRole("button", { name: "確認送出訂單" });
    vi.useFakeTimers();
    try {
      await act(async () => { fireEvent.click(button); await vi.advanceTimersByTimeAsync(15_001); });
      expect(screen.getByRole("alert").textContent).toMatch(/可能已送出/);
      expect(localStorage.getItem(holdKey)).toMatch(/^pending/);
      expect((screen.getByRole("button", { name: "請店員核對後解除" }) as HTMLButtonElement).disabled).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("does not post a stale in-memory cart that another tab already cleared", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<CartPage />);
    const button = await screen.findByRole("button", { name: "確認送出訂單" });
    localStorage.removeItem(cartKey); // another tab completed before its storage event was delivered
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("購物車是空的")).toBeTruthy());
    expect(fetcher).not.toHaveBeenCalled();
    expect(localStorage.getItem(holdKey)).toBeNull();
  });
  it("cleans up the original order without navigating a newly selected table", async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })));
    localStorage.setItem("cart-other", JSON.stringify([{ ...line, menuItem: { ...line.menuItem, name: "另一桌" } }]));
    const view = render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: "確認送出訂單" }));
    expect(localStorage.getItem(holdKey)).toMatch(/^pending/);
    params.token = "other";
    view.rerender(<CartPage />);
    expect(await screen.findByText("另一桌")).toBeTruthy();
    await act(async () => { complete(Response.json({ ok: true, orderId: "synthetic-order" })); });
    expect(router.push).not.toHaveBeenCalled();
    expect(localStorage.getItem(cartKey)).toBeNull();
    expect(localStorage.getItem(holdKey)).toBeNull();
    expect(localStorage.getItem("cart-other")).not.toBeNull();
    expect((screen.getByRole("button", { name: "確認送出訂單" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("does not remove a newer cart or hold when an old request succeeds later", async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })));
    render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: "確認送出訂單" }));
    expect(localStorage.getItem(holdKey)).toMatch(/^pending:/);
    const newCart = JSON.stringify([{ ...line, menuItem: { ...line.menuItem, id: "new", name: "新餐點" } }]);
    // Another tab manually resolved the old hold and began a new operation.
    localStorage.removeItem(holdKey);
    localStorage.setItem(cartKey, newCart);
    localStorage.setItem(holdKey, "pending:new-operation");
    await act(async () => { complete(Response.json({ ok: true, orderId: "old-order" })); });
    expect(localStorage.getItem(cartKey)).toBe(newCart);
    expect(localStorage.getItem(holdKey)).toBe("pending:new-operation");
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/已在其他分頁變更.*店員核對/);
  });
  it("keeps a distinct review hold across reload when an old hold was cleared before success", async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const first = render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: "確認送出訂單" }));
    localStorage.removeItem(holdKey); // another tab manually released; cart unchanged
    await act(async () => { complete(Response.json({ ok: true, orderId: "old-order" })); });
    expect(localStorage.getItem(cartKey)).not.toBeNull();
    expect(localStorage.getItem(holdKey)).toBeNull();
    expect(Object.keys(localStorage).some((key) => key.startsWith(`${holdKey}:review:`))).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    first.unmount();
    render(<CartPage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/可能已送出.*店員確認/);
    expect((screen.getByRole("button", { name: "確認送出訂單" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not remove a newer hold created during the staff confirmation", async () => {
    localStorage.setItem(holdKey, "pending:old");
    vi.spyOn(window, "confirm").mockImplementation(() => { localStorage.setItem(holdKey, "pending:new"); return true; });
    render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: "請店員核對後解除" }));
    expect(localStorage.getItem(holdKey)).toBe("pending:new");
    expect((screen.getByRole("button", { name: "確認送出訂單" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/仍有待確認/);
  });
});
