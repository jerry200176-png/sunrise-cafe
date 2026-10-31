// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrderAddRecovery } from "./use-order-add-recovery";

const items = [{ menu_item_id: "11111111-1111-1111-1111-111111111111", quantity: 2, option_ids: [], special_notes: "敏感備註" }];
const key = "11111111-1111-4111-8111-111111111111";
const storedKey = `sunrise.order-add.pending.v1:r1:${key}`;

describe("durable add request recovery", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

  it("stores only identifiers before the request and removes them on acknowledged success", async () => {
    let observed = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      observed = String(localStorage.getItem(localStorage.key(0)!));
      const request = JSON.parse(String(init.body));
      expect(JSON.parse(observed)).toEqual({ version: 2, reservationId: "r1", key: request.idempotency_key });
      expect(request.items).toEqual(items);
      return Response.json({ ok: true, committed: true });
    }));
    const { result } = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.begin(items); });
    expect(observed).not.toContain("敏感備註");
    expect(observed).not.toContain(items[0].menu_item_id);
    expect(result.current.pending).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("preserves an unknown result across logout/remount and checks the same key without sending the payload again", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      if (sent.length === 1) throw new TypeError("connection lost after commit");
      return Response.json({ ok: true, state: "committed" });
    });
    vi.stubGlobal("fetch", fetcher);
    const first = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { await expect(first.result.current.begin(items)).rejects.toThrow(); });
    expect(first.result.current.pending).toHaveLength(1);
    const raw = localStorage.getItem(localStorage.key(0)!)!;
    expect(raw).not.toContain("敏感備註");
    expect(raw).not.toContain(items[0].menu_item_id);
    first.unmount(); // logout/unmount must not erase unknown intent
    const restored = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(restored.result.current.pending).toHaveLength(1));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await expect(restored.result.current.begin(items)).rejects.toThrow(/待確認/); });
    await act(async () => { await restored.result.current.check(restored.result.current.pending[0]); });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ action: "add_status", idempotency_key: sent[0].idempotency_key });
    expect(restored.result.current.pending).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("does not clear the hold for unknown status, denied access, timeout or invalid cancellation", async () => {
    localStorage.setItem(storedKey, JSON.stringify({ version: 2, reservationId: "r1", key }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, state: "unknown" }))
      .mockResolvedValueOnce(Response.json({ error: "denied" }, { status: 403 }))
      .mockRejectedValueOnce(new TypeError("network lost"))
      .mockResolvedValueOnce(Response.json({ ok: true, state: "unknown" }))
      .mockResolvedValueOnce(Response.json({ ok: true, state: "canceled" }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    for (let i = 0; i < 3; i++) {
      await act(async () => { await expect(result.current.check(result.current.pending[0])).rejects.toThrow(); });
      expect(localStorage.getItem(storedKey)).not.toBeNull();
    }
    await act(async () => { await expect(result.current.cancel(result.current.pending[0])).rejects.toThrow(); });
    expect(localStorage.getItem(storedKey)).not.toBeNull();
    await act(async () => { expect(await result.current.cancel(result.current.pending[0])).toBe("canceled"); });
    expect(localStorage.getItem(storedKey)).toBeNull();
    for (const [, init] of fetcher.mock.calls) expect(JSON.parse(String(init.body)).idempotency_key).toBe(key);
  });

  it("treats cancellation that finds a committed operation as committed", async () => {
    localStorage.setItem(storedKey, JSON.stringify({ version: 2, reservationId: "r1", key }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, state: "committed" })));
    const { result } = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    await act(async () => { expect(await result.current.cancel(result.current.pending[0])).toBe("committed"); });
    expect(localStorage.length).toBe(0);
  });

  it("keeps the key after a lost cancellation response until a later authorized status confirms it", async () => {
    localStorage.setItem(storedKey, JSON.stringify({ version: 2, reservationId: "r1", key }));
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("cancel response lost"))
      .mockResolvedValueOnce(Response.json({ ok: true, state: "canceled" }));
    vi.stubGlobal("fetch", fetcher);
    const first = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(first.result.current.pending).toHaveLength(1));
    await act(async () => { await expect(first.result.current.cancel(first.result.current.pending[0])).rejects.toThrow(); });
    expect(localStorage.getItem(storedKey)).not.toBeNull();
    first.unmount();
    const afterLogin = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(afterLogin.result.current.pending).toHaveLength(1));
    await act(async () => { expect(await afterLogin.result.current.check(afterLogin.result.current.pending[0])).toBe("canceled"); });
    expect(localStorage.getItem(storedKey)).toBeNull();
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init.body)).action)).toEqual(["cancel_add", "add_status"]);
  });

  it("does not issue a request if durable storage cannot be written", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    await act(async () => { await expect(result.current.begin(items)).rejects.toThrow(/無法安全保存/); });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.storageError).toContain("暫停加點");
  });

  it("retains identifiers when the server does not respond before the timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    const { result } = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    try {
      await act(async () => {
        const checked = expect(result.current.begin(items)).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(15_001);
        await checked;
      });
      expect(result.current.pending).toHaveLength(1);
      expect(JSON.stringify(result.current.pending)).not.toContain("敏感備註");
    } finally { vi.useRealTimers(); }
  });

  it("scrubs old stored meal data while preserving the request ID", async () => {
    localStorage.setItem(storedKey, JSON.stringify({ version: 1, reservationId: "r1", key, items, itemNames: ["私密餐點"] }));
    const { result } = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    expect(JSON.parse(localStorage.getItem(storedKey)!)).toEqual({ version: 2, reservationId: "r1", key });
  });

  it("fails closed for malformed pending data and scopes the hold to its reservation", async () => {
    localStorage.setItem("sunrise.order-add.pending.v1:r1:bad-key", "not-json");
    const first = renderHook(() => useOrderAddRecovery("r1"));
    await waitFor(() => expect(first.result.current.storageError).toContain("暫停加點"));
    const other = renderHook(() => useOrderAddRecovery("r2"));
    await waitFor(() => expect(other.result.current.ready).toBe(true));
    expect(other.result.current.storageError).toBe("");
  });
});
