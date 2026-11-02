// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import BookPage from "./page";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/fetch-with-timeout", () => ({ fetchWithTimeout: mocks.fetch, readJsonWithTimeout: (response: Response) => response.json() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/customer/StorePreview", () => ({ StorePreview: () => null }));
vi.mock("@/components/payment/PaymentModal", () => ({ PaymentModal: () => null }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const start = Date.parse("2099-10-02T17:00:00Z"); // 2099-10-03 Saturday 01:00 in Taipei
const slots = Array.from({ length: 4 }, (_, i) => ({
  start: new Date(start + i * 30 * 60_000).toISOString(),
  end: new Date(start + (i + 1) * 30 * 60_000).toISOString(),
  available: true,
}));
const room = { roomId: "room-1", roomName: "測試房", capacity: 8, price_weekday: 200, price_weekend: 300, slots };

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  mocks.fetch.mockReset();
  vi.unstubAllGlobals();
});

describe("booking price at the Taipei day boundary", () => {
  it("shows the next day's weekend price and date for an overnight slot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ preorderEnabled: false, items: [] })));
    vi.stubGlobal("scrollTo", vi.fn());
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === "/api/branches") return json([{ id: "branch-1", name: "測試店" }]);
      if (url === "/api/settings") return json({ rental_notes: [], closed_dates: [] });
      if (url.startsWith("/api/rooms")) return json([{ id: "room-1", branch_id: "branch-1", name: "測試房", capacity: 8, price_weekday: 200, price_weekend: 300 }]);
      if (url.startsWith("/api/availability")) return json(url.includes("roomId=") ? { roomName: "測試房", branchName: "測試店", slots } : { branchName: "測試店", rooms: [room] });
      return json({});
    });
    render(<LocaleProvider><BookPage /></LocaleProvider>);
    fireEvent.change(await screen.findByLabelText("選擇日期"), { target: { value: "2099-10-02" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(await screen.findByRole("button", { name: /測試房/ }));
    fireEvent.click(await screen.findByRole("button", { name: "01:00–03:00" }));
    const bar = screen.getByRole("region", { name: "下一步 · 填寫資料" });
    fireEvent.click(within(bar).getByRole("button", { name: "下一步 · 填寫資料" }));
    expect(await screen.findByText(/2099-10-03/)).toBeTruthy();
    expect(screen.getByText("NT$ 600")).toBeTruthy();
    expect(screen.getByText("NT$ 300")).toBeTruthy();
    expect(mocks.fetch.mock.calls.some(([url]) => url === "/api/reservations")).toBe(false);
  });
});
