// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import BookQueryPage from "@/app/book/query/page";
import AdminPaymentsPage from "@/app/admin/payments/page";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), params: new URLSearchParams("token=synthetic") }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/fetch-with-timeout", () => ({ fetchWithTimeout: mocks.fetch, readJsonWithTimeout: (response: Response) => response.json() }));
vi.mock("@/components/admin/AdminShell", () => ({ AdminShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <main>{actions}{children}</main> }));

const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
let reduced = false;
let events: Array<{ target: Element; options: ScrollIntoViewOptions }>;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const booking = {
  id: "synthetic-1", booking_code: "ABC123", room_id: "room-1", branch_id: "branch-1",
  room_name: "測試包廂", branch_name: "測試店", customer_name: "測試客", payment_info: "測試銀行",
  start_time: "2099-01-03T10:00:00Z", end_time: "2099-01-03T12:00:00Z", created_at: "2099-01-01T00:00:00Z",
  status: "confirmed", is_deposit_paid: false, deposit_required: true, deposit_amount: 500,
  total_price: 1000, guest_count: 2, allowed_actions: ["reschedule"],
};
const payment = (id: string, name: string) => ({
  id, reservation_id: `r-${id}`, booking_code: id, customer_name: name, phone: "0900000000",
  start_time: "2099-01-03T10:00:00Z", created_at: "2099-01-01T00:00:00Z", deposit_amount: 500,
  reservation_status: "confirmed", raw_payload: null, source: "bank_transfer", is_deposit_paid: false,
  reported_account_last_five: null, reported_amount: null, reported_at: null,
});

beforeEach(() => {
  reduced = false;
  events = [];
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })));
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: function (this: Element, options: ScrollIntoViewOptions) { events.push({ target: this, options }); } });
  mocks.fetch.mockReset();
});
afterEach(() => {
  cleanup();
  if (scrollDescriptor) Object.defineProperty(Element.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("interaction scrolling respects the current preference", () => {
  it("keeps query payment target and reschedule focus while preferences change", async () => {
    mocks.fetch.mockImplementation(async (url: string) => url === "/api/my-bookings" ? json([booking]) : json({ ok: true }));
    render(<LocaleProvider><BookQueryPage /></LocaleProvider>);
    const region = await screen.findByRole("region", { name: /需繳納訂金/ });
    const cta = within(region).getByRole("button", { name: "我已完成轉帳" });
    fireEvent.click(cta);
    expect(events.at(-1)?.target.id).toBe("transfer-report-synthetic-1");
    expect(events.at(-1)?.options).toEqual({ block: "center", behavior: "smooth" });
    reduced = true;
    fireEvent.click(cta);
    expect(events.at(-1)?.options).toEqual({ block: "center", behavior: "instant" });

    fireEvent.click(screen.getByRole("button", { name: "自助改期" }));
    const date = screen.getByLabelText(/選擇新日期/) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(date));
    expect(events.at(-1)?.target.contains(date)).toBe(true);
    expect(events.at(-1)?.options).toEqual({ block: "nearest", behavior: "instant" });
    fireEvent.click(screen.getByRole("button", { name: "取消改期" }));
    reduced = false;
    fireEvent.click(screen.getByRole("button", { name: "自助改期" }));
    expect(events.at(-1)?.options).toEqual({ block: "nearest", behavior: "smooth" });
    expect(document.activeElement).toBe(screen.getByLabelText(/選擇新日期/));
  });

  it("keeps payment-list keyboard selection and nearest alignment", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("migration-status")) return json({ payment_events_ready: true });
      if (url.endsWith("pending")) return json([payment("p1", "測試甲"), payment("p2", "測試乙")]);
      return json({ items: [] });
    });
    render(<AdminPaymentsPage />);
    const second = await screen.findByText("測試乙");
    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(events.at(-1)?.target.textContent).toContain("測試甲");
    expect(events.at(-1)?.options).toEqual({ block: "nearest", behavior: "smooth" });
    reduced = true;
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(events.at(-1)?.target.contains(second)).toBe(true));
    expect(events.at(-1)?.options).toEqual({ block: "nearest", behavior: "instant" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.fetch.mock.calls.every(([url]) => !String(url).includes("/approve") && !String(url).includes("/reject"))).toBe(true);
  });
});
