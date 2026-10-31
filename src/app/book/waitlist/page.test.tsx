// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import WaitlistPage from "./page";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const branches = [{ id: "a", name: "甲店" }, { id: "b", name: "乙店" }];
const roomA = { id: "a-room", name: "甲包廂", branch_id: "a" };
const roomB = { id: "b-room", name: "乙包廂", branch_id: "b" };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, "", "/"); });

function showPage(url: string) {
  window.history.replaceState({}, "", url);
  render(<LocaleProvider><WaitlistPage /></LocaleProvider>);
}

describe("waitlist room selection", () => {
  it("restores the exact room from a booking card link after its branch rooms load", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => url === "/api/branches" ? Promise.resolve(json(branches)) : pending));
    showPage("/book/waitlist?branchId=a&roomId=a-room&date=2099-01-01");
    expect((await screen.findByLabelText("包廂") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "加入等位清單" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release(json([roomA])));
    await waitFor(() => expect((screen.getByLabelText("包廂") as HTMLSelectElement).value).toBe("a-room"));
    expect((screen.getByLabelText("分店") as HTMLSelectElement).value).toBe("a");
    expect(screen.getByRole("option", { name: "甲包廂" })).toBeTruthy();
  });

  it("clears the old room, blocks submission while switching and ignores a late response", async () => {
    let releaseA!: (response: Response) => void;
    let releaseB!: (response: Response) => void;
    const slowA = new Promise<Response>((resolve) => { releaseA = resolve; });
    const slowB = new Promise<Response>((resolve) => { releaseB = resolve; });
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return Promise.resolve(json({ error: "test" }, 409)); }
      if (url === "/api/branches") return Promise.resolve(json(branches));
      return url.includes("branchId=a") ? slowA : slowB;
    }));
    showPage("/book/waitlist?branchId=a&roomId=a-room&date=2099-01-01");
    const branch = await screen.findByLabelText("分店") as HTMLSelectElement;
    await waitFor(() => expect(branch.disabled).toBe(false));
    fireEvent.change(branch, { target: { value: "b" } });
    const room = screen.getByLabelText("包廂") as HTMLSelectElement;
    expect(room.value).toBe("");
    expect(room.disabled).toBe(true);
    fireEvent.submit(room.closest("form")!);
    expect(posts).toHaveLength(0);
    await act(async () => releaseB(json([roomB])));
    await screen.findByRole("option", { name: "乙包廂" });
    await act(async () => releaseA(json([roomA])));
    expect(screen.queryByRole("option", { name: "甲包廂" })).toBeNull();
    fireEvent.change(room, { target: { value: "b-room" } });
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "客人" } });
    fireEvent.change(screen.getByLabelText("手機號碼"), { target: { value: "0912345678" } });
    fireEvent.submit(room.closest("form")!);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ branch_id: "b", room_id: "b-room" });
  });

  it("clears an already selected room immediately when the branch changes", async () => {
    let releaseB!: (response: Response) => void;
    const pendingB = new Promise<Response>((resolve) => { releaseB = resolve; });
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts.push(init.body); return Promise.resolve(json({ ok: true })); }
      if (url === "/api/branches") return Promise.resolve(json(branches));
      return url.includes("branchId=a") ? Promise.resolve(json([roomA])) : pendingB;
    }));
    showPage("/book/waitlist?branchId=a&roomId=a-room&date=2099-01-01");
    const room = await screen.findByLabelText("包廂") as HTMLSelectElement;
    await waitFor(() => expect(room.value).toBe("a-room"));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "客人" } });
    fireEvent.change(screen.getByLabelText("手機號碼"), { target: { value: "0912345678" } });
    fireEvent.change(screen.getByLabelText("分店"), { target: { value: "b" } });
    expect(room.value).toBe("");
    expect(room.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "加入等位清單" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(room.closest("form")!);
    expect(posts).toHaveLength(0);
    await act(async () => releaseB(json([roomB])));
    await screen.findByRole("option", { name: "乙包廂" });
    expect(room.value).toBe("");
  });

  it("does not submit mismatched or failed room lists and can retry", async () => {
    let requests = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(json({ ok: true }));
      if (url === "/api/branches") return Promise.resolve(json(branches));
      requests++;
      return Promise.resolve(json(requests === 1 ? [roomB] : [roomA]));
    });
    vi.stubGlobal("fetch", fetchMock);
    showPage("/book/waitlist?branchId=a&roomId=a-room&date=2099-01-01");
    await screen.findByText("無法載入包廂。");
    expect((screen.getByRole("button", { name: "加入等位清單" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    await screen.findByRole("option", { name: "甲包廂" });
    expect(requests).toBe(2);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each([undefined, null])("rejects room responses without a valid branch id (%s)", async (branch_id) => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(json(url === "/api/branches" ? branches : [{ id: "a-room", name: "甲包廂", branch_id }]))));
    showPage("/book/waitlist?branchId=a&roomId=a-room&date=2099-01-01");
    expect(await screen.findByText("無法載入包廂。")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "甲包廂" })).toBeNull();
    expect((screen.getByRole("button", { name: "加入等位清單" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("holds an interrupted POST body across reload without persisting personal data or resending", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(init.body);
        return Promise.resolve(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); } })));
      }
      return Promise.resolve(json(url === "/api/branches" ? branches : [roomA]));
    }));
    showPage("/book/waitlist?branchId=a&roomId=a-room&date=2099-01-01");
    await waitFor(() => expect((screen.getByLabelText("包廂") as HTMLSelectElement).value).toBe("a-room"));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "測試客人" } });
    fireEvent.change(screen.getByLabelText("手機號碼"), { target: { value: "0912345678" } });
    const form = screen.getByLabelText("包廂").closest("form")!;
    vi.useFakeTimers();
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); await vi.advanceTimersByTimeAsync(15_010); });
    vi.useRealTimers();
    expect(posts).toHaveLength(1);
    expect((await screen.findByRole("alert")).textContent).toContain("無法確認是否已加入候位");
    expect((screen.getByRole("button", { name: "加入等位清單" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sessionStorage.getItem("sunrise.waitlist.pending.v1")).toBe("1");
    expect(JSON.stringify(sessionStorage)).not.toContain("0912345678");
    expect(JSON.stringify(sessionStorage)).not.toContain("測試客人");
    cleanup();
    showPage("/book/waitlist?branchId=a&roomId=a-room&date=2099-01-01");
    expect((await screen.findByRole("alert")).textContent).toContain("無法確認是否已加入候位");
    expect((screen.getByRole("button", { name: "加入等位清單" }) as HTMLButtonElement).disabled).toBe(true);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "已向店家確認" }));
    expect(sessionStorage.getItem("sunrise.waitlist.pending.v1")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "已向店家確認" }));
    expect(sessionStorage.getItem("sunrise.waitlist.pending.v1")).toBeNull();
    expect(posts).toHaveLength(1);
  });
});
