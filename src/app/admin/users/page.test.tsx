// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminUsersPage from "./page";

vi.mock("@/lib/fetch-with-timeout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fetch-with-timeout")>();
  return {
    fetchWithTimeout: (input: string, init?: RequestInit) => actual.fetchWithTimeout(input, init, 30),
    readJsonWithTimeout: (response: Response) => actual.readJsonWithTimeout(response, 30),
  };
});

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const me = { role: "owner", permissions: { users_manage: true } };
const users = [{ id: "u1", email: "test@example.test", display_name: "Test", role: "staff", is_active: true, branch_ids: ["b1"] }];

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function setup(post: (init: RequestInit) => Promise<Response>) {
  const calls: string[] = [];
  let failList = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    if (init.method === "POST") { calls.push(String(init.body)); return post(init); }
    if (input === "/api/admin/me") return json(me);
    if (failList) return json({ error: "unavailable" }, 503);
    return json({ users });
  }));
  render(<AdminUsersPage />);
  fireEvent.change(await screen.findByPlaceholderText("Email"), { target: { value: "new@example.test" } });
  fireEvent.change(screen.getByPlaceholderText("密碼（至少 8 字）"), { target: { value: "test-password" } });
  fireEvent.change(screen.getByPlaceholderText("分店 UUID（逗號分隔，owner 可留空）"), { target: { value: "b1" } });
  return { calls, failList: (value: boolean) => { failList = value; } };
}

describe("admin user creation recovery", () => {
  it("submits once during a fast double click and refreshes only after confirmed success", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const { calls } = await setup(() => pending);
    const button = screen.getByRole("button", { name: "建立" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(calls).toHaveLength(1);
    expect((screen.getByRole("button", { name: "建立中…" }) as HTMLButtonElement).disabled).toBe(true);
    finish(json({ ok: true, id: "created" }));
    expect(await screen.findByText(/帳號已建立，請確認清單/)).toBeTruthy();
    expect((screen.getByPlaceholderText("密碼（至少 8 字）") as HTMLInputElement).value).toBe("");
    expect(calls).toHaveLength(1);
  });

  it("shows a confirmed validation rejection without treating it as an unknown creation", async () => {
    const { calls } = await setup(async () => json({ error: "非 owner 角色須指定至少一個分店" }, 400));
    fireEvent.click(screen.getByRole("button", { name: "建立" }));
    expect(await screen.findByText("非 owner 角色須指定至少一個分店")).toBeTruthy();
    expect(screen.queryByText(/建立結果尚未確認/)).toBeNull();
    expect((screen.getByRole("button", { name: "建立" }) as HTMLButtonElement).disabled).toBe(false);
    expect(calls).toHaveLength(1);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps the hold after reload without storing account details", async () => {
    const { calls } = await setup(async () => { throw new TypeError("network lost"); });
    fireEvent.click(screen.getByRole("button", { name: "建立" }));
    expect(await screen.findByText(/建立結果尚未確認/)).toBeTruthy();
    expect(sessionStorage.getItem("sunrise.admin-user-create.pending.v1")).toBe("1");
    expect(JSON.stringify(sessionStorage)).not.toContain("new@example.test");
    expect(JSON.stringify(sessionStorage)).not.toContain("test-password");
    cleanup();
    render(<AdminUsersPage />);
    expect(await screen.findByText(/建立結果尚未確認/)).toBeTruthy();
    expect((await screen.findByRole("button", { name: "建立" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("does not send a creation request if it cannot persist the hold", async () => {
    const { calls } = await setup(async () => json({ ok: true, id: "created" }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    fireEvent.click(screen.getByRole("button", { name: "建立" }));
    expect(await screen.findByText(/尚未送出請求/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("holds a confirmed creation if the subsequent user list cannot be refreshed", async () => {
    const { calls, failList } = await setup(async () => json({ ok: true, id: "created" }));
    failList(true);
    fireEvent.click(screen.getByRole("button", { name: "建立" }));
    expect(await screen.findByText(/帳號已建立，但清單未能更新/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "建立" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sessionStorage.getItem("sunrise.admin-user-create.pending.v1")).toBe("1");
    expect(calls).toHaveLength(1);
  });

  it.each(["network", "header timeout", "body timeout", "non-json", "non-json success", "server error"])("holds a %s outcome for manual verification without resending", async (failure) => {
    const { calls, failList } = await setup(async (init) => {
      if (failure === "network") throw new TypeError("network lost");
      if (failure === "header timeout") return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
      if (failure === "body timeout") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); } }));
      if (failure === "non-json") return new Response("upstream failure", { status: 502 });
      if (failure === "non-json success") return new Response("unexpected success page", { status: 200 });
      return json({ error: "audit write failed" }, 500);
    });
    fireEvent.click(screen.getByRole("button", { name: "建立" }));
    expect(await screen.findByText(/建立結果尚未確認/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "建立" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByPlaceholderText("密碼（至少 8 字）") as HTMLInputElement).value).toBe("");
    expect(calls).toHaveLength(1);
    failList(true);
    fireEvent.click(screen.getByRole("button", { name: "重新整理並核對清單" }));
    expect(await screen.findByText(/無法確認使用者清單/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "已核對，允許重新操作" })).toBeNull();
    failList(false);
    fireEvent.click(screen.getByRole("button", { name: "重新整理並核對清單" }));
    const unlock = await screen.findByRole("button", { name: "已核對，允許重新操作" });
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(unlock);
    expect((screen.getByRole("button", { name: "建立" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(unlock);
    await waitFor(() => expect((screen.getByRole("button", { name: "建立" }) as HTMLButtonElement).disabled).toBe(false));
    expect(calls).toHaveLength(1);
  });
});
