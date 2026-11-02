// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import DashboardPage from "./page";

const mocked = vi.hoisted(() => ({
  branches: [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }],
  fetch: vi.fn(),
}));
vi.mock("@/lib/use-admin-branches", () => ({ useAdminBranches: () => ({ branches: mocked.branches, loading: false, error: null, retry: vi.fn() }) }));
vi.mock("@/lib/fetch-with-timeout", () => ({ fetchWithTimeout: mocked.fetch, readJsonWithTimeout: (response: Response) => response.json() }));
vi.mock("@/components/admin/AdminShell", () => ({ AdminShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <main>{actions}{children}</main> }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("recharts", () => ({ BarChart: () => null, Bar: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, Legend: () => null, ResponsiveContainer: () => null }));

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExec = Object.getOwnPropertyDescriptor(document, "execCommand");
const originalFetch = globalThis.fetch;
const reminder = (id: string, branch_name: string, customer_name: string) => ({ id, branch_name, customer_name, room_name: "測試房", phone: "0900000000", start_time: "2026-11-01T02:00:00Z", end_time: "2026-11-01T03:00:00Z", is_notified: false });
let reminders = [reminder("r1", "甲店", "測試甲"), reminder("r2", "乙店", "測試乙")];
function clipboard(value: unknown) { Object.defineProperty(navigator, "clipboard", { configurable: true, value }); }
function legacy(value: unknown) { Object.defineProperty(document, "execCommand", { configurable: true, value }); }
async function show() {
  const view = render(<LocaleProvider><DashboardPage /></LocaleProvider>);
  await screen.findByText(/測試甲 · 甲店/);
  return view;
}

beforeEach(() => {
  mocked.branches = [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }];
  reminders = [reminder("r1", "甲店", "測試甲"), reminder("r2", "乙店", "測試乙")];
  mocked.fetch.mockReset();
  mocked.fetch.mockImplementation(async (input: string) => new Response(JSON.stringify(input.startsWith("/api/admin/reminders") ? reminders : { trend: { points: [] } }), { status: 200 }));
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard); else Reflect.deleteProperty(navigator, "clipboard");
  if (originalExec) Object.defineProperty(document, "execCommand", originalExec); else Reflect.deleteProperty(document, "execCommand");
  globalThis.fetch = originalFetch;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("dashboard reminder copying", () => {
  it("waits for clipboard success without changing notification state", async () => {
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    clipboard({ writeText });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "複製提醒" }));
    expect((screen.getByRole("button", { name: "複製中…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("您好 測試甲"));
    expect(screen.queryByText("已複製提醒內容")).toBeNull();
    await act(async () => finish());
    expect(screen.getByRole("status").textContent).toBe("已複製提醒內容");
    expect(screen.getByRole("button", { name: "標記已通知" })).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["reject", "fallback false"]) ("%s keeps selectable reminder text and does not mark notification", async (mode) => {
    if (mode === "reject") clipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    else { clipboard(undefined); legacy(vi.fn(() => false)); }
    await show();
    const button = screen.getByRole("button", { name: "複製提醒" });
    button.focus();
    fireEvent.click(button);
    const field = await screen.findByRole("textbox", { name: "可手動複製的文字" }) as HTMLTextAreaElement;
    expect(field.value).toContain("您好 測試甲");
    expect(field.readOnly).toBe(true);
    expect(document.activeElement).toBe(button);
    field.focus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(screen.queryByText("已複製提醒內容")).toBeNull();
    expect(screen.getByRole("button", { name: "標記已通知" })).toBeTruthy();
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"]) ("ignores late %s after switching away and back", async (outcome) => {
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    clipboard({ writeText: vi.fn(() => new Promise<void>((ok, fail) => { resolve = ok; reject = fail; })) });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "複製提醒" }));
    fireEvent.change(screen.getByLabelText("分店"), { target: { value: "b2" } });
    expect(screen.getByText(/測試乙 · 乙店/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("分店"), { target: { value: "b1" } });
    expect(screen.getByText(/測試甲 · 甲店/)).toBeTruthy();
    await act(async () => outcome === "resolve" ? resolve() : reject(new Error("denied")));
    expect(screen.getByRole("button", { name: "複製提醒" })).toBeTruthy();
    expect(screen.queryByText("已複製提醒內容")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("abandons pending feedback when the dashboard date changes", async () => {
    let resolve!: () => void;
    clipboard({ writeText: vi.fn(() => new Promise<void>((ok) => { resolve = ok; })) });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "複製提醒" }));
    fireEvent.click(screen.getByRole("button", { name: "後一天" }));
    await act(async () => resolve());
    await waitFor(() => expect(screen.getByRole("button", { name: "複製提醒" })).toBeTruthy());
    expect(screen.queryByText("已複製提醒內容")).toBeNull();
  });

  it("hides a manual reminder when branch permissions shrink", async () => {
    clipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const view = await show();
    fireEvent.click(screen.getByRole("button", { name: "複製提醒" }));
    expect((await screen.findByRole("textbox") as HTMLTextAreaElement).value).toContain("測試甲");
    mocked.branches = [{ id: "b2", name: "乙店" }];
    view.rerender(<LocaleProvider><DashboardPage /></LocaleProvider>);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/測試甲 · 甲店/)).toBeNull();
  });

  it("does not show old manual text after the same reservation is refreshed", async () => {
    clipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "複製提醒" }));
    expect((await screen.findByRole("textbox") as HTMLTextAreaElement).value).toContain("測試甲");
    reminders = [reminder("r1", "甲店", "更新客人")];
    fireEvent.click(screen.getByRole("button", { name: "重新整理儀表板" }));
    await screen.findByText(/更新客人 · 甲店/);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
