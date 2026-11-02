// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import BookSuccessPage from "@/app/book/success/page";
import BookQueryPage from "@/app/book/query/page";

const mocks = vi.hoisted(() => ({ params: new URLSearchParams(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }));
vi.mock("@/lib/fetch-with-timeout", () => ({ fetchWithTimeout: mocks.fetch }));
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
function clipboard(value: unknown) { Object.defineProperty(navigator, "clipboard", { configurable: true, value }); }
const json = (value: unknown) => ({ ok: true, json: async () => value });

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  mocks.fetch.mockReset();
  mocks.params = new URLSearchParams();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("guest booking pages copy feedback", () => {
  it("success page keeps the bank text and receipt available after a rejected copy", async () => {
    mocks.params = new URLSearchParams("code=ABC123&token=synthetic-token");
    sessionStorage.setItem("booking_success_meta", JSON.stringify({
      code: "ABC123", createdAt: "2099-01-01T00:00:00Z", startTime: "2099-01-03T10:00:00Z",
      endTime: "2099-01-03T12:00:00Z", branchName: "測試店", roomName: "測試包廂",
      customerName: "測試客", paymentInfo: "測試銀行 123", lookupToken: "synthetic-token",
    }));
    clipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<LocaleProvider><BookSuccessPage /></LocaleProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "複製匯款帳號" }));
    let fields = await screen.findAllByRole("textbox", { name: "可手動複製的文字" });
    expect((fields[0] as HTMLTextAreaElement).value).toBe("測試銀行 123");
    expect(screen.queryByRole("button", { name: "已複製帳號" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "複製訂位回條" }));
    await waitFor(() => expect(screen.getAllByRole("textbox", { name: "可手動複製的文字" })).toHaveLength(2));
    fields = screen.getAllByRole("textbox", { name: "可手動複製的文字" });
    expect((fields[0] as HTMLTextAreaElement).value).toContain("訂位碼：ABC123");
    expect((fields[0] as HTMLTextAreaElement).value).toContain("token=synthetic-token");
    expect((fields[1] as HTMLTextAreaElement).value).toBe("測試銀行 123");
  });

  it("query page keeps each booking's bank and receipt separate when copy fails", async () => {
    mocks.params = new URLSearchParams("token=synthetic-token");
    mocks.fetch.mockImplementation(async (url: string) => url === "/api/my-bookings" ? json([{
      id: "synthetic-1", booking_code: "ABC123", room_id: "room-1", branch_id: "branch-1",
      room_name: "測試包廂", branch_name: "測試店", customer_name: "測試客", payment_info: "測試銀行 123",
      start_time: "2099-01-03T10:00:00Z", end_time: "2099-01-03T12:00:00Z", status: "confirmed",
      is_deposit_paid: false, deposit_required: true, total_price: 1000, guest_count: 2,
    }]) : json({ ok: true }));
    clipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<LocaleProvider><BookQueryPage /></LocaleProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "複製匯款帳號" }));
    let fields = await screen.findAllByRole("textbox", { name: "可手動複製的文字" });
    expect((fields[0] as HTMLTextAreaElement).value).toBe("測試銀行 123");
    expect(screen.queryByRole("button", { name: "已複製帳號" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "複製訂位資訊" }));
    await waitFor(() => expect(screen.getAllByRole("textbox", { name: "可手動複製的文字" })).toHaveLength(2));
    fields = screen.getAllByRole("textbox", { name: "可手動複製的文字" });
    expect((fields[0] as HTMLTextAreaElement).value).toContain("訂位碼：ABC123");
    expect((fields[0] as HTMLTextAreaElement).value).toContain("token=synthetic-token");
    expect((fields[1] as HTMLTextAreaElement).value).toBe("測試銀行 123");
    expect(mocks.fetch.mock.calls.filter(([url]) => url === "/api/my-bookings")).toHaveLength(1);
  });
});
